import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tradingEngine': path.resolve(__dirname, './src/tradingEngine'),
      '@stores': path.resolve(__dirname, './src/stores')
    }
  }
});
