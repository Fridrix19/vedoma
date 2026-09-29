import { resolve } from 'node:path';

// Все настройки — из файла .env (см. .env.example).

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : /^(1|true|yes)$/i.test(v));

export const config = {
  botToken: process.env.BOT_TOKEN?.trim() ?? '',
  port: Number(process.env.PORT ?? 8080),
  /** Публичный https-адрес, по которому открыт сервер (туннель или хостинг). Нужен для ссылок и файлов. */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Имя бота в MAX (без @). Если пусто — берётся из /me. */
  botUsername: process.env.BOT_USERNAME?.replace(/^@/, '') ?? '',
  panelPassword: process.env.PANEL_PASSWORD ?? 'uniflow',
  /** Код для команды «/staff КОД» в боте — подписка сотрудника на уведомления деканата. */
  staffCode: process.env.STAFF_CODE ?? process.env.PANEL_PASSWORD ?? 'uniflow',
  /** Вход в Mini App по логину вне MAX (браузер). В MAX всё равно проверяется подпись initData. */
  allowBrowserLogin: bool(process.env.ALLOW_BROWSER_LOGIN, true),
  /** Кнопка «Демо-вход» в боте: привязать MAX к тестовому студенту без Mini App (пока Mini App не зарегистрирован в MAX). */
  demoBotLogin: bool(process.env.DEMO_BOT_LOGIN, true),
  /** Кнопки open_app вместо ссылок https://max.ru/<бот>?startapp=… */
  openAppButtons: bool(process.env.OPEN_APP_BUTTONS, false),
  maxApiUrl: process.env.MAX_API_URL || undefined,
  dataDir: resolve(process.env.DATA_DIR ?? 'data'),
  distDir: resolve(process.env.DIST_DIR ?? 'dist'),
  /** Jev (TypeSafe AI) — модель «System One» для классификации: выбирает услугу и значения полей-списков. */
  jev: {
    key: process.env.JEV_API_KEY?.trim() ?? '',
    model: process.env.JEV_MODEL || 'jev-latest',
    url: process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone',
  },
  llm: {
    url: process.env.LLM_API_URL ?? '',
    key: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
  },
};
