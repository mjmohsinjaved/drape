import { defaultLocale, type Locale } from './config';

/**
 * Messages are namespaced per feature (ARCHITECTURE §6.7):
 * `src/i18n/messages/{en,ur}/{common,auth,catalog,tryon,results,shortlist,share,enquiry,account,admin,errors}.json`
 *
 * A missing `ur` key falls back to the `en` value so a half-translated namespace degrades to
 * English rather than to a raw key. `locale-parity.test.ts` is the `ur`-complete mode that
 * fallback is paired with.
 *
 * ═══ Two things this file is careful about, both of them §9.1 ═══
 *
 * **1. The merge is done once, not once per request.** For `ur` this loads *both* catalogues and
 * deep-merges them. That is real work — fifteen namespaces, several thousand keys — and it was
 * being redone on every single request, uncached, for a result that cannot change between them:
 * the catalogues are static JSON compiled into the build. {@link mergedNamespace} memoises each
 * `(locale, namespace)` pair, so the merge happens at most thirty times for the life of the
 * process.
 *
 * **2. A subtree is only given the namespaces it uses.** `loadMessages(locale)` returns all
 * fifteen; that is right for the server, where `getTranslations` may reach for any of them, and
 * wrong for `NextIntlClientProvider`, whose payload is serialised into the HTML of every page.
 * `admin.json` alone is ~39.5 KB and it was being inlined for an anonymous visitor on the public
 * catalog grid, which is the one screen with a hard number attached to it — first contentful
 * paint on 4G under 2.5s. {@link CLIENT_NAMESPACES} names what each route group's client
 * components actually call `useTranslations` with, and each group layout provides that set.
 */
export const namespaces = [
  'common',
  'auth',
  'catalog',
  'browse',
  'consent',
  'photos',
  'tryon',
  'renders',
  'results',
  'shortlist',
  'share',
  'enquiry',
  'account',
  'admin',
  'errors',
] as const;

export type Namespace = (typeof namespaces)[number];

/**
 * ═══ What each route group ships to the browser ═══
 *
 * Every entry is the set of namespaces the group's **client components** reach for — server
 * components read through `getTranslations`, which goes to the request config and never touches
 * the client provider, so they cost nothing here.
 *
 * `base` is the floor: the shared chrome (`common`) and the D-5 state shells (`errors`). Every
 * other entry includes it, because `NextIntlClientProvider` *replaces* its parent's messages
 * rather than merging with them — a nested provider has to carry everything its subtree needs.
 *
 * Adding a `useTranslations('x')` to a client component under a group without adding `x` here is
 * a missing-message at runtime, not a type error. That is the cost of the saving; the comment on
 * each line says which components put it there.
 */
export const CLIENT_NAMESPACES = {
  /** Header, footer, locale switcher, theme toggle, and the six D-5 state shells. */
  base: ['common', 'errors'],
  /**
   * + the filter island and the try-on tray/button that sit on the public grid, and `photos`
   * for the picker's in-page add-a-photo panel on the garment page (`TryOnPhotoPicker` hosts
   * `PhotoGuidance` + `PhotoUploader` in a sheet, so the C-13/C-15 flow no longer navigates).
   */
  public: ['common', 'errors', 'browse', 'photos', 'tryon'],
  /** + the consumer fitting room's islands. Deliberately no `admin`. */
  consumer: ['common', 'errors', 'consent', 'photos', 'renders', 'shortlist', 'tryon'],
  /** + the sign-in forms, which share field copy with the account screens. */
  auth: ['common', 'errors', 'account', 'auth'],
  /** The console. */
  admin: ['common', 'errors', 'admin'],
  /** Role-ANY: renders the admin shell for an admin and the consumer shell for a consumer. */
  account: ['common', 'errors', 'account', 'admin', 'auth'],
  /** The S-2 switch — same two shells as `account`. */
  dashboard: ['common', 'errors', 'admin'],
} as const satisfies Record<string, readonly Namespace[]>;

export type ClientNamespaceGroup = keyof typeof CLIENT_NAMESPACES;

type MessageTree = Record<string, unknown>;

async function loadNamespace(locale: Locale, namespace: Namespace): Promise<MessageTree> {
  const imported = (await import(`./messages/${locale}/${namespace}.json`)) as {
    default: MessageTree;
  };
  return imported.default;
}

/** Deep merge where `override` wins, used to layer a locale on top of the English base. */
function deepMerge(base: MessageTree, override: MessageTree): MessageTree {
  const result: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isTree(existing) && isTree(value)) {
      result[key] = deepMerge(existing, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isTree(value: unknown): value is MessageTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One namespace, already layered over its English base — memoised for the life of the process.
 *
 * The cache holds the promise, not the resolved value, so two concurrent requests for the same
 * namespace share one merge rather than racing to do it twice.
 */
const mergedCache = new Map<string, Promise<MessageTree>>();

function mergedNamespace(locale: Locale, namespace: Namespace): Promise<MessageTree> {
  const key = `${locale}/${namespace}`;
  const cached = mergedCache.get(key);
  if (cached) return cached;

  const merged =
    locale === defaultLocale
      ? loadNamespace(defaultLocale, namespace)
      : Promise.all([
          loadNamespace(defaultLocale, namespace),
          loadNamespace(locale, namespace),
        ]).then(([base, translated]) => deepMerge(base, translated));

  mergedCache.set(key, merged);
  return merged;
}

/**
 * @param locale The negotiated locale.
 * @param wanted The namespaces to include. Defaults to all fifteen — right for the server config,
 *   too much for a client provider. See {@link CLIENT_NAMESPACES}.
 */
export async function loadMessages(
  locale: Locale,
  wanted: readonly Namespace[] = namespaces,
): Promise<MessageTree> {
  const trees = await Promise.all(wanted.map((ns) => mergedNamespace(locale, ns)));
  return Object.fromEntries(wanted.map((ns, index) => [ns, trees[index] ?? {}]));
}

/** The client provider's payload for one route group. */
export async function loadClientMessages(
  locale: Locale,
  group: ClientNamespaceGroup,
): Promise<MessageTree> {
  return loadMessages(locale, CLIENT_NAMESPACES[group]);
}
