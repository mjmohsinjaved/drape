/**
 * Tailwind v4 runs entirely through its PostCSS plugin — there is no `tailwindcss`
 * or `autoprefixer` entry any more, and no `tailwind.config.ts` either. v4 is
 * CSS-first: `src/styles/globals.css` imports `@repo/ui/styles/globals.css`, which
 * imports `tailwindcss` and then the shared preset (`@repo/config-tailwind`), where
 * the token → utility mapping lives as `@theme inline`. Source scanning is declared
 * with `@source` in those stylesheets rather than in a JS `content` array.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
