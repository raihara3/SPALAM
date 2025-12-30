import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/vite-env.d.ts',
        'src/workers/**/*.ts',
      ],
      thresholds: {
        // Global thresholds are intentionally low as not all code is tested yet
        // Focus is on helper functions and tracking modules which have 80%+ coverage
        lines: 8,
        functions: 10,
        branches: 8,
        statements: 8,
      },
    },
    setupFiles: ['./src/test/setup.ts'],
  },
});
