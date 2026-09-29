import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';

// ——— Проверка initData из MAX ———
// Алгоритм из https://dev.max.ru/docs/webapps/validation:
//   secret_key = HMAC_SHA256(key = "WebAppData", message = BOT_TOKEN)
//   launch_params = пары key=value (без hash), отсортированные по ключу и склеенные через \n
//   hash == hex(HMAC_SHA256(key = secret_key, message = launch_params))

export interface MaxInitData {
  user?: { id: number; first_name?: string; last_name?: string; username?: string };
  start_param?: string;
  auth_date?: number;
}

const MAX_AGE_SEC = 24 * 3600;

export function validateInitData(raw: string | undefined, botToken: string): MaxInitData | null {
  if (!raw || !botToken) return null;
  // initData может прийти целиком из фрагмента URL: берём часть после «WebAppData=» при наличии
  let str = raw.startsWith('#') ? raw.slice(1) : raw;
  const outer = new URLSearchParams(str);
  if (outer.has('WebAppData')) str = outer.get('WebAppData')!;

  const params = new URLSearchParams(str);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`);
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const check = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') ?? 0);
  if (authDate && Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;

  const out: MaxInitData = { auth_date: authDate || undefined, start_param: params.get('start_param') ?? undefined };
  const user = params.get('user');
  if (user) {
    try {
      out.user = JSON.parse(user);
    } catch {
      /* ignore */
    }
  }
  return out;
}

// ——— Подписанные токены сессии (студент / панель) ———

mkdirSync(config.dataDir, { recursive: true });
const secretFile = join(config.dataDir, 'session-secret');
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (existsSync(secretFile)
    ? readFileSync(secretFile, 'utf8').trim()
    : (() => {
        const s = randomBytes(32).toString('hex');
        writeFileSync(secretFile, s);
        return s;
      })());

const sign = (v: string) => createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');

export const makeToken = (kind: 'student' | 'panel', id: string) => `${kind}.${id}.${sign(`${kind}:${id}`)}`;

export function readToken(token: string | undefined, kind: 'student' | 'panel'): string | null {
  if (!token) return null;
  const [k, id, sig] = token.split('.');
  if (k !== kind || !id || !sig) return null;
  const expected = sign(`${kind}:${id}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
