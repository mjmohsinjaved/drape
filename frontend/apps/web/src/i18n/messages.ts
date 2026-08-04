import { defaultLocale, type Locale } from './config';

/**
 * Messages are namespaced per feature (ARCHITECTURE §6.7):
 * `src/i18n/messages/{en,ur}/{common,auth,catalog,tryon,results,shortlist,share,enquiry,account,admin,errors}.json`
 *
 * They are merged into one object per request. A missing `ur` key falls back to the `en`
 * value so a half-translated namespace degrades to English rather than to a raw key.
 */
export const namespaces = [
  'common',
  'auth',
  'catalog',
  'tryon',
  'results',
  'shortlist',
  'share',
  'enquiry',
  'account',
  'admin',
  'errors',
] as const;

export type Namespace = (typeof namespaces)[number];

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

export async function loadMessages(locale: Locale): Promise<MessageTree> {
  const bases = await Promise.all(namespaces.map((ns) => loadNamespace(defaultLocale, ns)));
  const english: MessageTree = Object.fromEntries(
    namespaces.map((ns, index) => [ns, bases[index] ?? {}]),
  );

  if (locale === defaultLocale) return english;

  const translated = await Promise.all(namespaces.map((ns) => loadNamespace(locale, ns)));
  const localised: MessageTree = Object.fromEntries(
    namespaces.map((ns, index) => [ns, translated[index] ?? {}]),
  );

  return deepMerge(english, localised);
}
