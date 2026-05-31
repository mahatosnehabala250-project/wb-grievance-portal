import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Minimal Vitest config for the property-based test suite.
// - Top-level `css.postcss: {}` supplies an inline (empty) PostCSS config so Vite
//   does NOT search for / load the Next.js + Tailwind v4 PostCSS config
//   (postcss.config.mjs), which Vite's PostCSS loader cannot parse because it
//   uses string-named plugins.
// - `environment: 'node'` because these are pure logic / property tests with no DOM.
export default defineConfig({
  // Resolve the project's `@/*` path alias (see tsconfig.json) so API route
  // handlers under src/app/api/* — which import shared libs as `@/lib/...` —
  // can be imported directly by the Vitest unit tests. Pure logic / property
  // tests that only use relative imports are unaffected.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    postcss: {},
  },
  test: {
    // Default environment stays `node` for the existing pure-logic / property /
    // API tests. React component tests opt into jsdom *per file* via the
    // `// @vitest-environment jsdom` docblock, so this global default is
    // intentionally left untouched.
    environment: 'node',
    // `.tsx` added so React component tests (e.g. tests/components/*.test.tsx)
    // are picked up. This is strictly additive — every existing `.ts` test
    // still matches.
    include: ['tests/**/*.{test,property.test}.{ts,tsx}'],
  },
});
