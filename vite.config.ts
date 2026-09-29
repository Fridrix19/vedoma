import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Режимы:
//   vite            — демо без сервера (данные в браузере)
//   vite --mode server / vite build --mode server — фронт работает с сервером (server/)
// Точки входа: index.html (демо-стенд), miniapp.html (Mini App для MAX), panel.html (панель вуза).
export default defineConfig(({ mode }) => {
  const backend = mode === 'server';
  return {
    plugins: [react()],
    base: './',
    define: { __BACKEND__: JSON.stringify(backend) },
    server: backend
      ? {
          proxy: {
            '/api': 'http://localhost:8080',
            '/files': 'http://localhost:8080',
          },
        }
      : undefined,
    build: {
      rollupOptions: {
        input: {
          demo: resolve(__dirname, 'index.html'),
          miniapp: resolve(__dirname, 'miniapp.html'),
          panel: resolve(__dirname, 'panel.html'),
        },
      },
    },
  };
});
