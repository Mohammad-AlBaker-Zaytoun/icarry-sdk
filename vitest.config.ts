import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // Barrel and pure type modules carry no testable logic.
      exclude: ['src/index.ts', 'src/types.ts'],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
