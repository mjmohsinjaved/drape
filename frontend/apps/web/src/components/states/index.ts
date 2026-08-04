/**
 * The D-5 state shells, in one import. Every screen in `apps/web` reaches its states from
 * here so no screen invents its own wording or its own layout for them.
 */
export { PageSkeleton, type PageSkeletonProps, type SkeletonVariant } from './Skeletons';
export { RouteError, type RouteErrorViewProps } from './RouteError';
export { DeniedState, type DeniedStateProps } from './DeniedState';
export { PagePlaceholder, type PagePlaceholderProps } from './PagePlaceholder';
export {
  EmptyNotice,
  OfflineNotice,
  SavedIndicator,
  SuccessNotice,
  type EmptyNoticeProps,
  type OfflineNoticeProps,
  type SavedIndicatorProps,
  type SuccessNoticeProps,
} from './StateShells';
