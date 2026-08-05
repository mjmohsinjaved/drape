/**
 * The layout language of the app. Two shells that share the token set and nothing else (D-4),
 * plus the pieces both draw from.
 */
export { AdminShell, type AdminShellProps } from './AdminShell';
export { ConsumerShell, type ConsumerShellProps } from './ConsumerShell';
export { PublicShell, type PublicShellProps } from './PublicShell';
export { AuthShell, type AuthShellProps } from './AuthShell';

export { Sidebar, type SidebarProps } from './Sidebar';
export { Topbar, type TopbarProps } from './Topbar';
export { MobileNav, type MobileNavProps } from './MobileNav';
export { ConsumerTopNav, type ConsumerTopNavProps } from './ConsumerTopNav';
export { UserMenu, type UserMenuProps } from './UserMenu';
export { LocaleSwitcher, type LocaleSwitcherProps } from './LocaleSwitcher';
export { ThemeToggle } from './ThemeToggle';
export { Breadcrumbs, type BreadcrumbsProps } from './Breadcrumbs';
export { NavLink, type NavLinkProps } from './NavLink';
export { SkipLink, MAIN_CONTENT_ID } from './SkipLink';
export { AdminShortcuts } from './AdminShortcuts';
export { AdminDensityRoot, type AdminDensityRootProps } from './AdminDensityRoot';
export { AdminMobileMenu, type AdminMobileMenuProps } from './AdminMobileMenu';
export { AdminSearchTrigger } from './AdminSearchTrigger';
export {
  accountMenuNav,
  adminNavGroups,
  consumerPrimaryNav,
  consumerSecondaryNav,
  type NavGroup,
  type NavItem,
} from './nav-items';
