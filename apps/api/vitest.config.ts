import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: integration tests are skipped unless DATABASE_URL_TEST is set in the environment.
}

export default defineConfig({
  // SWC is needed so Nest's DI gets decorator metadata (esbuild does not emit it).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
