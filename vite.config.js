import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ui.js'],
    // Frontend tests live alongside components; backend tests stay in /test
    // and run under plain `node --test`. The include glob below scopes vitest
    // to only the UI tests so we don't double-run the backend suite.
    include: ['src/**/*.test.{js,jsx}', 'test/ui/**/*.test.{js,jsx}'],
  },
});
