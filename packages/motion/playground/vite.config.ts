import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@lama/motion': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5180, open: false },
});
