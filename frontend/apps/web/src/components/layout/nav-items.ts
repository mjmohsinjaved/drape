import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Camera,
  ClipboardList,
  Database,
  Eye,
  FileText,
  Heart,
  Home,
  Images,
  Inbox,
  LayoutGrid,
  ListTree,
  MessageSquare,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  User,
  UserCog,
  Users,
} from 'lucide-react';

import { routes } from '@/lib/routes';

import type { LucideIcon } from 'lucide-react';
import type { Locale } from '@/i18n/config';

/**
 * Navigation inventory for both shells.
 *
 * Every `href` comes from `@/lib/routes` — no route string is written here, or anywhere else
 * outside that file. Labels are message keys, resolved by whichever shell renders them, so the
 * same item reads correctly in `en` and `ur`.
 */

export interface NavItem {
  key: string;
  /** Key under the `common.nav` (consumer) or `admin.nav` (admin) namespace. */
  labelKey: string;
  href: (locale: Locale) => string;
  icon: LucideIcon;
  /** Matches the item as active for any descendant path, not just an exact hit. */
  matchPrefix?: boolean;
}

export interface NavGroup {
  key: string;
  /** Key under `admin.nav.groups`. */
  labelKey: string;
  items: readonly NavItem[];
}

/**
 * Consumer bottom navigation — PRD C-9: Browse, Shortlist, My Renders, Account.
 *
 * "Try-ons" rather than "renders" in the visible label: things are named by what the user
 * controls, not by how the system is built (D-14, §10.5). The route stays `/renders`.
 */
export const consumerPrimaryNav: readonly NavItem[] = [
  { key: 'browse', labelKey: 'browse', href: routes.browse, icon: LayoutGrid, matchPrefix: true },
  { key: 'shortlist', labelKey: 'shortlist', href: routes.shortlist, icon: Heart },
  { key: 'renders', labelKey: 'renders', href: routes.renders, icon: Sparkles, matchPrefix: true },
  { key: 'account', labelKey: 'account', href: routes.account, icon: User, matchPrefix: true },
] as const;

/** The rest of the consumer surface, reached from the account menu rather than the tab bar. */
export const consumerSecondaryNav: readonly NavItem[] = [
  { key: 'photos', labelKey: 'photos', href: routes.photos, icon: Camera, matchPrefix: true },
  { key: 'enquiries', labelKey: 'enquiries', href: routes.enquiries, icon: MessageSquare, matchPrefix: true },
  { key: 'share', labelKey: 'share', href: routes.shareLinks, icon: Share2 },
] as const;

/**
 * The account menu. C-40 requires the data controls (C-37…C-39) to be reachable from the
 * account menu on **every** screen — `accountData` is that entry point and is never dropped
 * from this list.
 */
export const accountMenuNav: readonly NavItem[] = [
  { key: 'profile', labelKey: 'profile', href: routes.account, icon: User },
  { key: 'security', labelKey: 'security', href: routes.accountSecurity, icon: ShieldCheck },
  { key: 'notifications', labelKey: 'notifications', href: routes.accountNotifications, icon: Bell },
  { key: 'data', labelKey: 'data', href: routes.accountData, icon: Database },
] as const;

/**
 * Admin console navigation — dense, grouped, built for repetitive work (D-4). Ordered by how
 * often a studio owner touches it: the inbox and the catalog first, the setup last.
 */
export const adminNavGroups: readonly NavGroup[] = [
  {
    key: 'work',
    labelKey: 'work',
    items: [
      { key: 'dashboard', labelKey: 'dashboard', href: routes.dashboard, icon: Home },
      { key: 'enquiries', labelKey: 'enquiries', href: routes.admin.enquiries, icon: Inbox, matchPrefix: true },
      { key: 'moderation', labelKey: 'moderation', href: routes.admin.moderation, icon: ShieldAlert },
    ],
  },
  {
    key: 'catalog',
    labelKey: 'catalog',
    items: [
      { key: 'categories', labelKey: 'categories', href: routes.admin.categories, icon: ListTree },
      { key: 'catalog', labelKey: 'catalog', href: routes.admin.catalog, icon: Boxes, matchPrefix: true },
      { key: 'catalogHealth', labelKey: 'catalogHealth', href: routes.admin.catalogHealth, icon: Stethoscope },
    ],
  },
  {
    key: 'people',
    labelKey: 'people',
    items: [
      { key: 'consumers', labelKey: 'consumers', href: routes.admin.consumers, icon: Users, matchPrefix: true },
      { key: 'team', labelKey: 'team', href: routes.admin.team, icon: UserCog },
    ],
  },
  {
    key: 'insight',
    labelKey: 'insight',
    items: [
      { key: 'analytics', labelKey: 'analytics', href: routes.admin.analytics, icon: BarChart3 },
      { key: 'usage', labelKey: 'usage', href: routes.admin.usage, icon: Activity },
      { key: 'abuse', labelKey: 'abuse', href: routes.admin.abuse, icon: ShieldAlert },
      { key: 'audit', labelKey: 'audit', href: routes.admin.audit, icon: ClipboardList },
    ],
  },
  {
    key: 'setup',
    labelKey: 'setup',
    items: [
      { key: 'settings', labelKey: 'settings', href: routes.admin.settings, icon: Settings },
      { key: 'policy', labelKey: 'policy', href: routes.admin.settingsPolicy, icon: FileText },
      { key: 'preview', labelKey: 'preview', href: routes.admin.preview, icon: Eye },
    ],
  },
] as const;

/** Icons used by shells that do not import the lists above. */
export const shellIcons = { search: Search, images: Images } as const;
