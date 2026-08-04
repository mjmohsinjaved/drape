import { beforeEach, describe, expect, it } from 'vitest';

import { PERSIST_KEYS } from '../middleware/persist.middleware';

import {
  UI_PERSIST_VERSION,
  type UiState,
  migrateUiState,
  selectActiveModal,
  selectAdminDensity,
  selectCommandPaletteOpen,
  selectDirection,
  selectIsModalOpen,
  selectIsRtl,
  selectLocale,
  selectSidebarCollapsed,
  selectThemeMode,
  useUiStore,
} from './ui.store';

function state(): UiState {
  return useUiStore.getState();
}

describe('useUiStore — actions', () => {
  beforeEach(() => {
    state().reset();
  });

  it('starts on the documented defaults', () => {
    expect(state().themeMode).toBe('system');
    expect(state().sidebarCollapsed).toBe(false);
    expect(state().adminDensity).toBe('comfortable');
    expect(state().activeModal).toBeNull();
    expect(state().commandPaletteOpen).toBe(false);
    expect(state().locale).toBe('EN');
    expect(state().direction).toBe('ltr');
  });

  it('sets the theme mode', () => {
    state().setThemeMode('dark');
    expect(state().themeMode).toBe('dark');
  });

  it('toggles and sets the sidebar independently', () => {
    state().toggleSidebar();
    expect(state().sidebarCollapsed).toBe(true);

    state().toggleSidebar();
    expect(state().sidebarCollapsed).toBe(false);

    state().setSidebarCollapsed(true);
    state().setSidebarCollapsed(true);
    expect(state().sidebarCollapsed).toBe(true);
  });

  it('sets the A-14 table density', () => {
    state().setAdminDensity('compact');
    expect(state().adminDensity).toBe('compact');
  });

  it('opens and closes a modal, carrying its props', () => {
    state().openModal('delete-garment', { garmentId: 'g1' });
    expect(state().activeModal).toEqual({ id: 'delete-garment', props: { garmentId: 'g1' } });

    state().openModal('confirm-logout');
    expect(state().activeModal).toEqual({ id: 'confirm-logout', props: undefined });

    state().closeModal();
    expect(state().activeModal).toBeNull();
  });

  it('toggles the command palette', () => {
    state().setCommandPaletteOpen(true);
    expect(state().commandPaletteOpen).toBe(true);
    state().setCommandPaletteOpen(false);
    expect(state().commandPaletteOpen).toBe(false);
  });

  it('derives the direction from the locale — C-41 RTL', () => {
    state().setLocale('UR');
    expect(state().locale).toBe('UR');
    expect(state().direction).toBe('rtl');

    state().setLocale('EN');
    expect(state().direction).toBe('ltr');
  });

  it('reset restores every field', () => {
    state().setThemeMode('dark');
    state().setLocale('UR');
    state().openModal('x');
    state().reset();

    expect(state().themeMode).toBe('system');
    expect(state().locale).toBe('EN');
    expect(state().direction).toBe('ltr');
    expect(state().activeModal).toBeNull();
  });
});

describe('useUiStore — selectors', () => {
  const sample: UiState = {
    ...state(),
    themeMode: 'dark',
    sidebarCollapsed: true,
    adminDensity: 'compact',
    activeModal: { id: 'delete-garment' },
    commandPaletteOpen: true,
    locale: 'UR',
    direction: 'rtl',
  };

  it('reads each field in isolation', () => {
    expect(selectThemeMode(sample)).toBe('dark');
    expect(selectSidebarCollapsed(sample)).toBe(true);
    expect(selectAdminDensity(sample)).toBe('compact');
    expect(selectActiveModal(sample)).toEqual({ id: 'delete-garment' });
    expect(selectCommandPaletteOpen(sample)).toBe(true);
    expect(selectLocale(sample)).toBe('UR');
    expect(selectDirection(sample)).toBe('rtl');
    expect(selectIsRtl(sample)).toBe(true);
  });

  it('selectIsModalOpen matches only its own modal', () => {
    expect(selectIsModalOpen('delete-garment')(sample)).toBe(true);
    expect(selectIsModalOpen('confirm-logout')(sample)).toBe(false);
    expect(selectIsModalOpen('anything')({ ...sample, activeModal: null })).toBe(false);
  });
});

describe('ui persistence — key, version and migration', () => {
  it('uses the documented storage key', () => {
    expect(PERSIST_KEYS.ui).toBe('drape.ui');
  });

  it('migrates a well-formed payload untouched', () => {
    const persisted = { themeMode: 'dark', sidebarCollapsed: true, adminDensity: 'compact' };

    expect(migrateUiState(persisted, UI_PERSIST_VERSION)).toEqual(persisted);
  });

  it('falls back to defaults for a payload that is not an object', () => {
    const defaults = { themeMode: 'system', sidebarCollapsed: false, adminDensity: 'comfortable' };

    expect(migrateUiState(null, 0)).toEqual(defaults);
    expect(migrateUiState('corrupt', 0)).toEqual(defaults);
    expect(migrateUiState(undefined, 0)).toEqual(defaults);
  });

  it('repairs individual invalid fields rather than dropping the whole payload', () => {
    const result = migrateUiState(
      { themeMode: 'neon', sidebarCollapsed: 'yes', adminDensity: 'compact' },
      0,
    );

    expect(result).toEqual({
      themeMode: 'system',
      sidebarCollapsed: false,
      adminDensity: 'compact',
    });
  });

  it('discards a payload written by a newer version than this build understands', () => {
    const fromTheFuture = { themeMode: 'dark', sidebarCollapsed: true, adminDensity: 'compact' };

    expect(migrateUiState(fromTheFuture, UI_PERSIST_VERSION + 1)).toEqual({
      themeMode: 'system',
      sidebarCollapsed: false,
      adminDensity: 'comfortable',
    });
  });

  it('never persists the locale — the NEXT_LOCALE cookie owns it', () => {
    const persisted = migrateUiState(
      { themeMode: 'dark', sidebarCollapsed: false, adminDensity: 'comfortable', locale: 'UR' },
      UI_PERSIST_VERSION,
    );

    expect(persisted).not.toHaveProperty('locale');
    expect(persisted).not.toHaveProperty('direction');
  });
});
