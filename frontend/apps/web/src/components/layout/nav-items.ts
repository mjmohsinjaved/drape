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
  User,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface NavItem {
  key: string;
  labelKey: string;
  href: (locale: Locale) => string;
  icon: LucideIcon;
  matchPrefix?: boolean;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  items: readonly NavItem[];
}

export const consumerPrimaryNav: readonly NavItem[] = [
  { key: 'browse', labelKey: 'browse', href: routes.browse, icon: LayoutGrid, matchPrefix: true },
  { key: 'shortlist', labelKey: 'shortlist', href: routes.shortlist, icon: Heart },
  { key: 'renders', labelKey: 'renders', href: routes.renders, icon: Sparkles, matchPrefix: true },
  { key: 'account', labelKey: 'account', href: routes.account, icon: User, matchPrefix: true },
] as const;

export const browsePrimaryNav: readonly NavItem[] = consumerPrimaryNav.filter(
  (item) => item.key !== 'account',
);

export const consumerSecondaryNav: readonly NavItem[] = [
  { key: 'photos', labelKey: 'photos', href: routes.photos, icon: Camera, matchPrefix: true },
  {
    key: 'enquiries',
    labelKey: 'enquiries',
    href: routes.enquiries,
    icon: MessageSquare,
    matchPrefix: true,
  },
  { key: 'share', labelKey: 'share', href: routes.shareLinks, icon: Share2 },
] as const;

export const accountMenuNav: readonly NavItem[] = [
  { key: 'profile', labelKey: 'profile', href: routes.account, icon: User },
  { key: 'security', labelKey: 'security', href: routes.accountSecurity, icon: ShieldCheck },
  {
    key: 'notifications',
    labelKey: 'notifications',
    href: routes.accountNotifications,
    icon: Bell,
  },
  { key: 'data', labelKey: 'data', href: routes.accountData, icon: Database },
] as const;

export const adminNavGroups: readonly NavGroup[] = [
  {
    key: 'work',
    labelKey: 'work',
    items: [
      { key: 'dashboard', labelKey: 'dashboard', href: routes.dashboard, icon: Home },
      {
        key: 'enquiries',
        labelKey: 'enquiries',
        href: routes.admin.enquiries,
        icon: Inbox,
        matchPrefix: true,
      },
      {
        key: 'moderation',
        labelKey: 'moderation',
        href: routes.admin.moderation,
        icon: ShieldAlert,
      },
    ],
  },
  {
    key: 'catalog',
    labelKey: 'catalog',
    items: [
      { key: 'categories', labelKey: 'categories', href: routes.admin.categories, icon: ListTree },
      {
        key: 'catalog',
        labelKey: 'catalog',
        href: routes.admin.catalog,
        icon: Boxes,
        matchPrefix: true,
      },
    ],
  },
  {
    key: 'people',
    labelKey: 'people',
    items: [
      {
        key: 'consumers',
        labelKey: 'consumers',
        href: routes.admin.consumers,
        icon: Users,
        matchPrefix: true,
      },
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

export const shellIcons = { search: Search, images: Images } as const;
