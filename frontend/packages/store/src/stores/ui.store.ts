/**
 * Chrome preferences — ARCHITECTURE.md §6.5 (`useUiStore` + `useLocaleStore`).
 *
 * Persisted to `localStorage` under `drape.ui`, but **only the three durable preferences**.
 * `activeModal` and `commandPaletteOpen` are transient, and `locale`/`direction` are *not*
 * persisted here: the server needs the locale, so the `NEXT_LOCALE` cookie is its home and this
 * store only mirrors it for the current render tree. Persisting it in two places would let them
 * disagree, and the cookie would win on the server while `localStorage` won in the browser.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import { type Locale } from '@repo/api-client';
import { type Direction, getDirection } from '@repo/utils';

import { devtoolsOptions } from '../middleware/devtools.middleware';
import {
  PERSIST_KEYS,
  createPersistOptions,
  localJsonStorage,
} from '../middleware/persist.middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

/** A-14 tables get a denser mode; consumer screens never do. */
export type AdminDensity = 'comfortable' | 'compact';

export interface ActiveModal {
  id: string;
  props?: Record<string, unknown>;
}

export interface UiState {
  themeMode: ThemeMode;
  sidebarCollapsed: boolean;
  adminDensity: AdminDensity;
  activeModal: ActiveModal | null;
  commandPaletteOpen: boolean;
  locale: Locale;
  /** Derived from `locale`; kept in state so `<html dir>` reads one value rather than recomputing. */
  direction: Direction;

  setThemeMode: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setAdminDensity: (density: AdminDensity) => void;
  openModal: (id: string, props?: Record<string, unknown>) => void;
  closeModal: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  /**
   * Mirrors the locale the server negotiated. Writing the `NEXT_LOCALE` cookie and navigating is
   * the caller's job — a store never performs a side effect on the document or the router.
   */
  setLocale: (locale: Locale) => void;
  reset: () => void;
}

const DEFAULT_LOCALE: Locale = 'EN';

const initialState = {
  themeMode: 'system',
  sidebarCollapsed: false,
  adminDensity: 'comfortable',
  activeModal: null,
  commandPaletteOpen: false,
  locale: DEFAULT_LOCALE,
  direction: getDirection(DEFAULT_LOCALE),
} satisfies Omit<
  UiState,
  | 'setThemeMode'
  | 'toggleSidebar'
  | 'setSidebarCollapsed'
  | 'setAdminDensity'
  | 'openModal'
  | 'closeModal'
  | 'setCommandPaletteOpen'
  | 'setLocale'
  | 'reset'
>;

/** Exactly what lands in `localStorage`. Everything else is transient or server-owned. */
export interface PersistedUiState {
  themeMode: ThemeMode;
  sidebarCollapsed: boolean;
  adminDensity: AdminDensity;
}

/** Bump on any change to {@link PersistedUiState}, and extend `migrateUiState` in the same commit. */
export const UI_PERSIST_VERSION = 1;

const PERSISTED_DEFAULTS: PersistedUiState = {
  themeMode: initialState.themeMode,
  sidebarCollapsed: initialState.sidebarCollapsed,
  adminDensity: initialState.adminDensity,
};

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
const ADMIN_DENSITIES: readonly AdminDensity[] = ['comfortable', 'compact'];

/**
 * Rehydrates a payload written by an older version.
 *
 * Version 0 is anything written before this store was versioned. Rather than trusting its shape,
 * each field is validated individually and falls back to its default — a preference is not worth a
 * crash, and a hand-edited `localStorage` entry must not be able to poison the store.
 */
export function migrateUiState(persisted: unknown, fromVersion: number): PersistedUiState {
  if (typeof persisted !== 'object' || persisted === null) return { ...PERSISTED_DEFAULTS };

  // `unknown` values, not a cast to the target shape: this payload came from storage and a user
  // can edit it by hand.
  const candidate = persisted as Record<string, unknown>;

  const themeMode = THEME_MODES.find((mode) => mode === candidate.themeMode) ?? PERSISTED_DEFAULTS.themeMode;

  const adminDensity =
    ADMIN_DENSITIES.find((density) => density === candidate.adminDensity) ??
    PERSISTED_DEFAULTS.adminDensity;

  const sidebarCollapsed =
    typeof candidate.sidebarCollapsed === 'boolean'
      ? candidate.sidebarCollapsed
      : PERSISTED_DEFAULTS.sidebarCollapsed;

  // Future versions branch here. `fromVersion` is read so the parameter is never silently unused.
  return fromVersion > UI_PERSIST_VERSION
    ? { ...PERSISTED_DEFAULTS }
    : { themeMode, sidebarCollapsed, adminDensity };
}

export const useUiStore = create<UiState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        setThemeMode: (themeMode) => set({ themeMode }, false, 'ui/setThemeMode'),

        toggleSidebar: () =>
          set(
            (state) => ({ sidebarCollapsed: !state.sidebarCollapsed }),
            false,
            'ui/toggleSidebar',
          ),

        setSidebarCollapsed: (sidebarCollapsed) =>
          set({ sidebarCollapsed }, false, 'ui/setSidebarCollapsed'),

        setAdminDensity: (adminDensity) => set({ adminDensity }, false, 'ui/setAdminDensity'),

        openModal: (id, props) => set({ activeModal: { id, props } }, false, 'ui/openModal'),

        closeModal: () => set({ activeModal: null }, false, 'ui/closeModal'),

        setCommandPaletteOpen: (commandPaletteOpen) =>
          set({ commandPaletteOpen }, false, 'ui/setCommandPaletteOpen'),

        setLocale: (locale) =>
          set({ locale, direction: getDirection(locale) }, false, 'ui/setLocale'),

        reset: () => set({ ...initialState }, false, 'ui/reset'),
      }),
      createPersistOptions<UiState, PersistedUiState>({
        name: PERSIST_KEYS.ui,
        version: UI_PERSIST_VERSION,
        storage: localJsonStorage<PersistedUiState>(),
        partialize: (state) => ({
          themeMode: state.themeMode,
          sidebarCollapsed: state.sidebarCollapsed,
          adminDensity: state.adminDensity,
        }),
        migrate: migrateUiState,
      }),
    ),
    devtoolsOptions('ui'),
  ),
);

/* ------------------------------------------------------------------- selectors */

export const selectThemeMode = (state: UiState): ThemeMode => state.themeMode;
export const selectSidebarCollapsed = (state: UiState): boolean => state.sidebarCollapsed;
export const selectAdminDensity = (state: UiState): AdminDensity => state.adminDensity;
export const selectActiveModal = (state: UiState): ActiveModal | null => state.activeModal;
export const selectCommandPaletteOpen = (state: UiState): boolean => state.commandPaletteOpen;
export const selectLocale = (state: UiState): Locale => state.locale;
export const selectDirection = (state: UiState): Direction => state.direction;
export const selectIsRtl = (state: UiState): boolean => state.direction === 'rtl';

/** True only for the named modal, so an unrelated modal opening does not re-render this one. */
export const selectIsModalOpen =
  (id: string) =>
  (state: UiState): boolean =>
    state.activeModal?.id === id;

export const useThemeMode = (): ThemeMode => useUiStore(selectThemeMode);
export const useSidebarCollapsed = (): boolean => useUiStore(selectSidebarCollapsed);
export const useAdminDensity = (): AdminDensity => useUiStore(selectAdminDensity);
export const useActiveModal = (): ActiveModal | null => useUiStore(selectActiveModal);
export const useIsModalOpen = (id: string): boolean => useUiStore(selectIsModalOpen(id));
export const useCommandPaletteOpen = (): boolean => useUiStore(selectCommandPaletteOpen);
export const useLocale = (): Locale => useUiStore(selectLocale);
export const useDirection = (): Direction => useUiStore(selectDirection);
export const useIsRtl = (): boolean => useUiStore(selectIsRtl);

export const useUiActions = (): Pick<
  UiState,
  | 'setThemeMode'
  | 'toggleSidebar'
  | 'setSidebarCollapsed'
  | 'setAdminDensity'
  | 'openModal'
  | 'closeModal'
  | 'setCommandPaletteOpen'
  | 'setLocale'
> =>
  useUiStore(
    useShallow((state) => ({
      setThemeMode: state.setThemeMode,
      toggleSidebar: state.toggleSidebar,
      setSidebarCollapsed: state.setSidebarCollapsed,
      setAdminDensity: state.setAdminDensity,
      openModal: state.openModal,
      closeModal: state.closeModal,
      setCommandPaletteOpen: state.setCommandPaletteOpen,
      setLocale: state.setLocale,
    })),
  );
