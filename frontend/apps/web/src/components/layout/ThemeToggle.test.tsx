// @vitest-environment jsdom

import Link from 'next/link';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from '@repo/ui';

import { renderWithProviders } from '@/test/harness';

import { ThemeToggle } from './ThemeToggle';

/**
 * Two defects, both reachable by opening the theme menu and picking an option.
 *
 * 1. **Picking a theme did nothing.** The control wrote to `useUiStore.themeMode`, which
 *    nothing read: `ThemeProvider` owns the `dark` class on `<html>`, its own `localStorage`
 *    key, and the `ThemeScript` that applies both before first paint. So the button's icon
 *    changed and the page stayed exactly as it was — two states for one rule, and the one the
 *    control wrote was the one with no reader.
 *
 * 2. **`<DropdownMenuItem asChild>` threw at render.** `asChild` turns the item into a Radix
 *    `Slot`, which accepts exactly one child — it only adopts a child on the branch
 *    `React.Children.count(children) === 1`. The wrapper's body was `{children}{shortcut ? … :
 *    null}`, and `Children.count` counts an empty slot, so the count was always 2 and Slot threw
 *    "Primitive.div failed to slot onto its children". Every `asChild` item in the app hit it —
 *    the whole account menu is built from them.
 */
describe('ThemeToggle', () => {
  it('applies the theme rather than only changing its own icon', async () => {
    const user = userEvent.setup();
    document.documentElement.classList.remove('dark');

    await renderWithProviders(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /theme/i }));
    await user.click(await screen.findByRole('menuitem', { name: /lamplight/i }));

    // The class on <html> is the whole point: it is what every token in the design system
    // resolves against. Asserting the store here would have passed against the broken version.
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: /theme/i }));
    await user.click(await screen.findByRole('menuitem', { name: /daylight/i }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });
});

describe('DropdownMenuItem asChild', () => {
  it('renders a caller-owned element without throwing', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <DropdownMenu>
          <DropdownMenuTrigger>Open</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem asChild>
              <Link href="/en/account">Account</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ThemeProvider>,
    );

    await user.click(screen.getByText('Open'));

    // Before the fix this never rendered — Slot threw while the menu was opening.
    const item = await screen.findByRole('menuitem', { name: 'Account' });
    expect(item.tagName).toBe('A');
    expect(item.getAttribute('href')).toBe('/en/account');
  });
});

describe('useTheme', () => {
  function Probe() {
    const { mode } = useTheme();
    return <span data-testid="mode">{mode}</span>;
  }

  it('falls back to the default when nothing is stored', () => {
    window.localStorage.clear();

    render(
      <ThemeProvider defaultMode="system">
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mode').textContent).toBe('system');
  });

  it('prefers a stored preference over the default', () => {
    // A preference set on a previous visit has to survive — which is the reason the mode lives
    // here and not in a second store: this key is also what `ThemeScript` reads to apply the
    // class before first paint, so the two can never be made to agree from elsewhere.
    window.localStorage.clear();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    render(
      <ThemeProvider defaultMode="system">
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });
});
