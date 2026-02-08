import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    watch: {
      // Ignore runtime data files written by the main process so they don't
      // trigger Vite HMR / full page reloads during development.
      ignored: ['**/tasks.md', '**/tasks.md.tmp', '**/journal/**'],
    },
  },
});
