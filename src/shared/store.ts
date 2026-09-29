import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DB } from './types';
import { createSeed } from './seed';
import { BACKEND } from './mode';

// Локальный «бэкенд» демо: состояние в localStorage + синхронизация между вкладками.
// Mini App в одной вкладке и панель в другой видят одни и те же заявки.
// При подключении настоящего API заменяется реализация в api.ts, экраны не меняются.

const KEY = 'uniflow.db.v1';
const listeners = new Set<() => void>();

function load(): DB | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DB;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function save(db: DB) {
  if (BACKEND) return; // с сервером данные живут на сервере
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Переполнение/запрет хранилища — демо продолжает работать в памяти
  }
}

const emptyDB = (): DB => ({ version: 1, tenants: [], students: [], services: [], requests: [], messages: [], drafts: [], nextRequestId: 0 });

let db: DB = BACKEND ? emptyDB() : load() ?? createSeed();

const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (BACKEND || e.key !== KEY) return;
    const next = load();
    if (next) {
      db = next;
      emit();
    }
  });
}

export const getDB = () => db;

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Иммутабельное обновление: fn получает глубокую копию и мутирует её. */
export function update(fn: (draft: DB) => void) {
  const next = structuredClone(db);
  fn(next);
  db = next;
  save(db);
  emit();
}

/** Режим с сервером: подменить данные тем, что вернул API. */
export function replaceDB(next: Partial<DB>) {
  db = { ...db, ...next };
  emit();
}

export function resetDB() {
  db = createSeed();
  save(db);
  emit();
}

export function useDB(): DB {
  return useSyncExternalStore(subscribe, getDB, getDB);
}

const memory = new Map<string, string>(); // запасной вариант, если localStorage недоступен

/** Состояние, которое помнится между перезагрузками (сессия студента, роль в панели). */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const read = () => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      /* хранилище недоступно */
    }
    raw = raw ?? memory.get(key) ?? null;
    try {
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  };
  const [value, setValue] = useState<T>(read);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setValue(read());
    };
    const onLocal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) setValue(read());
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('uniflow:persist', onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('uniflow:persist', onLocal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    memory.set(key, JSON.stringify(v));
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
    // Другие компоненты на этой же странице (демо-стенд) узнают об изменении
    window.dispatchEvent(new CustomEvent('uniflow:persist', { detail: key }));
  };
  return [value, set];
}

// Простая шина событий между поверхностями внутри одной страницы (демо-стенд):
// например, кнопка «Оформить» из бота открывает нужный экран Mini App.
type BusEvent =
  | { type: 'miniapp:open-draft'; draftId: string }
  | { type: 'miniapp:open-request'; requestId: number }
  | { type: 'panel:open-request'; requestId: number }
  | { type: 'panel:new-service' };

const bus = new Set<(e: BusEvent) => void>();
export const emitBus = (e: BusEvent) => bus.forEach((l) => l(e));
export function useBus(handler: (e: BusEvent) => void) {
  useEffect(() => {
    bus.add(handler);
    return () => {
      bus.delete(handler);
    };
  }, [handler]);
}
