import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { StoredFile } from '../src/shared/types';
import { uid } from '../src/shared/domain';
import { config } from './config';

// Файлы заявок: data/files/<id>/<имя>. Ссылка /files/<id>/<имя> — id случайный и не угадывается.

const root = join(config.dataDir, 'files');
mkdirSync(root, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024;

const safeName = (name: string) =>
  basename(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';

/** Сохраняет файл, пришедший из браузера как data URL. */
export function saveDataUrl(input: { name: string; mime?: string; dataUrl?: string }): StoredFile {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(input.dataUrl ?? '');
  if (!m) throw new Error(`Файл «${input.name}» не загрузился. Попробуйте ещё раз.`);
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  if (buf.length > MAX_BYTES) throw new Error('Файл больше 10 МБ.');
  const id = uid(16);
  const name = safeName(input.name);
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, name), buf);
  return { name, size: buf.length, mime: input.mime || m[1] || 'application/octet-stream', url: `/files/${id}/${encodeURIComponent(name)}` };
}

/** Сохраняет файл, созданный на сервере (например, справку PDF). */
export function saveBuffer(name: string, mime: string, buf: Buffer): StoredFile {
  const id = uid(16);
  const safe = safeName(name);
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, safe), buf);
  return { name: safe, size: buf.length, mime, url: `/files/${id}/${encodeURIComponent(safe)}` };
}

/** Путь на диске по url вида /files/<id>/<имя>. */
export function pathFromUrl(url: string | undefined): string | null {
  const m = /^\/files\/([a-z0-9]{16})\/([^/]+)$/.exec(url ?? '');
  if (!m) return null;
  const p = join(root, m[1], safeName(decodeURIComponent(m[2])));
  return existsSync(p) ? p : null;
}

/** Приводит файл из запроса к серверному виду: data URL → файл на диске. */
export function persistFile(f: StoredFile & { dataUrl?: string }): StoredFile {
  if (f.url && pathFromUrl(f.url)) return { name: f.name, size: f.size, mime: f.mime, url: f.url };
  return saveDataUrl(f);
}
