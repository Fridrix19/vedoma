import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../src/shared/types';
import { createSeed } from '../src/shared/seed';
import { config } from './config';

// Хранилище MVP: один JSON-файл data/db.json. Для хакатона достаточно;
// структура совпадает с таблицами будущей БД (tenants, students, services, requests, messages).

const file = join(config.dataDir, 'db.json');
mkdirSync(config.dataDir, { recursive: true });

let db: DB = load();

function load(): DB {
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as DB;
      if (parsed.version === 1) {
        parsed.staff ??= [];
        return parsed;
      }
    } catch (e) {
      console.error('[db] Не удалось прочитать db.json, создаю заново:', (e as Error).message);
    }
  }
  const seed = createSeed();
  seed.staff = [];
  // Демо-история заявок: убираем тестовую привязку к MAX, чтобы уведомления уходили только реальным людям
  writeFileSync(file, JSON.stringify(seed, null, 2));
  return seed;
}

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, file);
  }, 150);
}

export const getDB = () => db;

/** Изменение данных: fn работает с копией, при ошибке ничего не сохраняется. */
export function mutate<T>(fn: (d: DB) => T): T {
  const draft = structuredClone(db);
  const result = fn(draft);
  db = draft;
  scheduleSave();
  return result;
}

export function resetDB() {
  db = createSeed();
  db.staff = [];
  scheduleSave();
}
