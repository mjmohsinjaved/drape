/**
 * Navigation feedback — the gap between a click and the first byte of the new segment.
 *
 * The 55 `loading.tsx` fallbacks only paint once the server starts streaming. Everything here
 * covers the moment before that, which on the mid-range Android over mobile data that §9.1
 * targets is the moment the app either feels alive or feels broken.
 */
export { LinkPending, type LinkPendingProps } from './LinkPending';
export { NavigationProgressBar } from './NavigationProgressBar';
