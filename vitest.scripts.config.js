import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['.github/scripts/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['.github/scripts/**/*.js'],
      exclude: ['.github/scripts/**/*.test.js'],
    },
  },
});
