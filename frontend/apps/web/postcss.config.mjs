/**
 * Tailwind v4 runs entirely through its PostCSS plugin — there is no `tailwindcss`
 * or `autoprefixer` entry any more. Token → utility mapping lives in the shared
 * preset (`@repo/config-tailwind`), pulled in by `tailwind.config.ts`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
