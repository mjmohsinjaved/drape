import { afterEach } from 'vitest';

/**
 * Shared test setup.
 *
 * Runs for both environments, so everything here is guarded on there being a DOM: the source
 * checks (copy rules, locale parity, logical properties) execute in `node` and must not pay for
 * a renderer they never use.
 */
if (typeof window !== 'undefined') {
  // Testing Library's auto-cleanup only registers itself when it can see the globals; importing
  // it explicitly keeps one test's tray out of the next test's DOM.
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });

  // jsdom implements neither, and the design system reads both. `matchMedia` drives the
  // responsive hooks and the reduced-motion preference; `ResizeObserver` is used by Radix.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }

  // Radix's menus and selects call all three during a pointer interaction; jsdom has none.
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => undefined;
  }

  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe(): void {
        /* no layout in jsdom */
      }
      unobserve(): void {
        /* no layout in jsdom */
      }
      disconnect(): void {
        /* no layout in jsdom */
      }
    };
  }
}
