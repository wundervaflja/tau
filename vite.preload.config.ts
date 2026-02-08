import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/tasks.md', '**/tasks.md.tmp'],
    },
  },
});
