import { defineConfig } from 'vitest/config';

// base 用相對路徑，同時相容 GitHub Pages 與 itch.io
export default defineConfig({
  base: './',
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
