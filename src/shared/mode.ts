// Режим работы фронта задаётся при сборке (vite.config.ts):
//   npm run dev / build:demo — демо без сервера, данные в браузере;
//   npm run build / dev:server — работа с сервером (server/), ботом MAX и общей базой.
declare const __BACKEND__: boolean;
export const BACKEND: boolean = typeof __BACKEND__ !== 'undefined' && __BACKEND__;
