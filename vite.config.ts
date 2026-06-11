import { defineConfig } from 'vitest/config';

// On GitHub Pages a project site is served from /<repo>/, so the build needs a
// matching base path. Override with BASE_PATH in CI; default to root for local
// dev and preview.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
