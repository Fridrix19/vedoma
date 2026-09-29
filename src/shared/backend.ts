import type { DB } from './types';
import { replaceDB } from './store';
import { webApp } from './max';

// HTTP-клиент к серверу «Ведома» (server/). Используется только в режиме BACKEND.

const TOKEN_KEY = { student: 'uniflow.token.student', panel: 'uniflow.token.panel' } as const;
type Kind = keyof typeof TOKEN_KEY;

const mem: Partial<Record<Kind, string>> = {};

export function getToken(kind: Kind): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY[kind]) ?? mem[kind] ?? null;
  } catch {
    return mem[kind] ?? null;
  }
}

export function setToken(kind: Kind, token: string | null) {
  if (token) mem[kind] = token;
  else delete mem[kind];
  try {
    if (token) localStorage.setItem(TOKEN_KEY[kind], token);
    else localStorage.removeItem(TOKEN_KEY[kind]);
  } catch {
    /* ignore */
  }
}

export class AuthRequired extends Error {
  constructor(public kind: Kind) {
    super('need_login');
  }
}

export async function http<T = unknown>(method: string, path: string, body?: unknown, auth: Kind | null = null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const initData = webApp()?.initData;
  if (initData) headers['X-Max-Init-Data'] = initData;
  if (auth === 'student') headers['X-Session'] = getToken('student') ?? '';
  if (auth === 'panel') headers['X-Panel-Token'] = getToken('panel') ?? '';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && auth) {
    if ((data as { error?: string }).error === 'need_login') {
      setToken(auth, null);
      throw new AuthRequired(auth);
    }
  }
  if (!res.ok) throw new Error(data?.error || `Ошибка сервера (${res.status})`);
  return data;
}

// ——— Синхронизация состояния ———

export async function syncStudent() {
  const state = await http<Partial<DB>>('GET', '/api/student/state', undefined, 'student');
  replaceDB(state);
}

export async function syncPanel(tenantId: string) {
  const state = await http<Partial<DB>>('GET', `/api/panel/state?tenantId=${encodeURIComponent(tenantId)}`, undefined, 'panel');
  replaceDB(state);
}

export interface PublicTenant {
  id: string;
  name: string;
  short: string;
  demoEmail: string;
}

export const fetchPublicTenants = () =>
  http<{ tenants: PublicTenant[]; browserLogin: boolean }>('GET', '/api/public/tenants');

/** Автовход в MAX: если профиль уже привязан к пользователю MAX. */
export async function trySessionFromMax(): Promise<{ studentId: string; startParam: string | null } | null> {
  if (!webApp()?.initData) return null;
  try {
    const r = await http<{ token: string; studentId: string; startParam: string | null }>('POST', '/api/student/session');
    setToken('student', r.token);
    return { studentId: r.studentId, startParam: r.startParam };
  } catch {
    return null;
  }
}
