import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Однофайловая сборка демо-стенда (для публикации одной ссылкой).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  define: { __BACKEND__: 'false' },
  build: { outDir: 'dist-demo', emptyOutDir: true },
});
