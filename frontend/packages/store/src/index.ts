/**
 * `@repo/store` — ARCHITECTURE.md §6.5.
 *
 * **Zustand holds client state only.** Anything the API owns lives in TanStack Query, and a
 * `fetch` inside a store is a review failure. Five stores, each under the size where it should
 * have been split:
 *
 * | Store | What it holds | Persisted |
 * | --- | --- | --- |
 * | `useAuthStore` | the session user, for rendering — **never an authorisation decision** (S-3, B-10) | No |
 * | `useUiStore` | theme, sidebar, density, modal, locale, direction | `localStorage` · `drape.ui` |
 * | `useTryOnTrayStore` | in-flight jobs and finished results (C-19) | `sessionStorage` · `drape.tryon-tray` |
 * | `useShortlistDraftStore` | optimistic drag order and its rollback baseline (C-32, D-18) | No |
 * | `useConsentStore` | the C-11 gate's state for the current policy version | No |
 *
 * **Every read goes through a selector.** Each store exports granular hooks
 * (`useThemeMode`, `useTrayUnseenCount`, …) and a `use*Actions()` bundle behind `useShallow`, so
 * no component ever subscribes to a whole store.
 */

export * from './middleware';
export * from './stores';
