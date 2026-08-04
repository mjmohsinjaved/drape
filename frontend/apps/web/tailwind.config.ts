import sharedPreset from '@repo/config-tailwind';

import type { Config } from 'tailwindcss';

/**
 * The preset is the only place tokens become utilities (ARCHITECTURE §6.1). This file adds
 * nothing but content paths — no colours, no spacing, no font stacks. A raw hex value or an
 * arbitrary Tailwind value in `apps/web` is a lint failure (D-1).
 */
const config: Config = {
  presets: [sharedPreset],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
    // The design-system atoms are consumed from source, so their classes must be scanned too.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  // Dark mode is opt-in via `class="dark"` on <html>, resolved from `prefers-color-scheme`
  // plus the stored preference (ARCHITECTURE §6.1).
  darkMode: 'class',
};

export default config;
