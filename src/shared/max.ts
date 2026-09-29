// Обёртка над MAX Bridge (https://dev.max.ru/docs/webapps/bridge).
// В MAX скрипт https://st.max.ru/js/max-web-app.js создаёт window.WebApp.
// Вне MAX (браузер, демо-стенд) все вызовы безопасно деградируют.

interface MaxWebApp {
  initData?: string;
  initDataUnsafe?: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string };
    start_param?: string;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { impactOccurred(style: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid'): void };
  downloadFile?: (url: string, fileName: string) => void;
  openLink?: (url: string) => void;
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

export const webApp = (): MaxWebApp | undefined => (typeof window !== 'undefined' ? window.WebApp : undefined);

export const isInsideMax = () => Boolean(webApp()?.initData);

/**
 * Параметр запуска Mini App.
 * Бот открывает приложение ссылкой https://max.ru/<bot>?startapp=<payload>:
 *   draft_<id>  — черновик заявки, созданный ИИ-маршрутизатором (услуга + предзаполненные поля)
 *   svc_<id>    — сразу форма услуги
 *   req_<id>    — карточка заявки (кнопка «Открыть заявку» в уведомлении)
 * Вне MAX то же самое можно передать через ?startapp=...
 */
export function getStartParam(): string | null {
  const fromMax = webApp()?.initDataUnsafe?.start_param;
  if (fromMax) return fromMax;
  try {
    return new URLSearchParams(window.location.search).get('startapp');
  } catch {
    return null;
  }
}

export function haptic(style: 'light' | 'medium' = 'light') {
  try {
    webApp()?.HapticFeedback?.impactOccurred(style);
  } catch {
    /* вне MAX */
  }
}

let backHandler: (() => void) | null = null;
export function setBackButton(handler: (() => void) | null) {
  const bb = webApp()?.BackButton;
  if (!bb) return;
  if (backHandler) bb.offClick(backHandler);
  backHandler = handler;
  if (handler) {
    bb.onClick(handler);
    bb.show();
  } else bb.hide();
}

/** Открыть внешнюю ссылку: в MAX — через WebApp.openLink, в браузере — новой вкладкой. */
export function openExternal(url: string) {
  const abs = new URL(url, window.location.href).href;
  const wa = webApp();
  if (wa?.openLink) wa.openLink(abs);
  else window.open(abs, '_blank', 'noopener');
}

/** Страница проверки подлинности документа по его номеру. */
export const verifyHref = (docId: string) => `/verify/${encodeURIComponent(docId)}`;

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Скачивание файла:
 *  1) внутри MAX — WebApp.downloadFile (нужен https-URL с бэкенда);
 *  2) в обычном браузере — ссылкой download.
 * Возвращает 'saved' | 'declined' | 'unavailable'.
 */
export async function downloadStoredFile(file: { name: string; dataUrl?: string; url?: string }): Promise<'saved' | 'declined' | 'unavailable'> {
  const wa = webApp();
  const abs = file.url ? new URL(file.url, window.location.href).href : undefined;
  if (wa?.downloadFile && abs?.startsWith('https://')) {
    wa.downloadFile(abs, file.name);
    return 'saved';
  }
  if (!file.url && !file.dataUrl) return 'unavailable';


  try {
    const a = document.createElement('a');
    a.href = abs ?? file.dataUrl!;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
