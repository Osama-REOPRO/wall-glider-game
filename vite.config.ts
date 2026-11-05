import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (GitHub Pages, artifact hosts, file servers).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1000,
  },
});
