import { defineConfig } from 'vite';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
