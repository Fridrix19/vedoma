import type { BotMessage, DB, Draft, Service, ServiceRequest, StoredFile } from './types';
import { addWorkingDays, isPastDeadline } from './dates';
import { botTexts } from './notifications';

// Бизнес-логика заявок. Чистые функции над объектом DB (мутируют переданную копию).
// Одна и та же логика работает и в браузере (демо без сервера), и на сервере (server/).
// Каждая мутация возвращает новые сообщения бота — сервер отправляет их в MAX.

const now = () => new Date().toISOString();
export const uid = (len = 10) => {
  const a = new Uint8Array(len);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
};

function pushMessage(d: DB, out: BotMessage[], m: Omit<BotMessage, 'id' | 'at'>) {
  const msg: BotMessage = { ...m, id: uid(), at: now() };
  d.messages.push(msg);
  if (d.messages.length > 200) d.messages.splice(0, d.messages.length - 200);
  out.push(msg);
}

export class DomainError extends Error {}

export function findRequest(d: DB, id: number) {
  const r = d.requests.find((x) => x.id === id);
  if (!r) throw new DomainError(`Заявка №${id} не найдена`);
  const svc = d.services.find((s) => s.id === r.serviceId)!;
  const st = d.students.find((s) => s.id === r.studentId)!;
  return { r, svc, st };
}

// ——— Селекторы ———

export const isOverdue = (r: ServiceRequest) =>
  (r.status === 'accepted' || r.status === 'in_progress') && isPastDeadline(r.deadline);

export const isActive = (r: ServiceRequest) => r.status !== 'done' && r.status !== 'rejected';

export function findStudentByLogin(d: DB, tenantId: string, email: string, password: string) {
  const st = d.students.find((s) => s.tenantId === tenantId && s.email.toLowerCase() === email.trim().toLowerCase());
  if (!st) throw new DomainError('Не нашли студента с таким логином в выбранном вузе. Проверьте email.');
  if (password.length < 4) throw new DomainError('Введите пароль от личного кабинета вуза.');
  return st;
}

// ——— Студент ———

export interface CreateRequestInput {
  studentId: string;
  serviceId: string;
  values: Record<string, string>;
  files: Record<string, StoredFile>;
  channel: 'miniapp' | 'bot';
  draftId?: string;
}

export function createRequest(d: DB, p: CreateRequestInput) {
  const out: BotMessage[] = [];
  const svc = d.services.find((s) => s.id === p.serviceId);
  const st = d.students.find((s) => s.id === p.studentId);
  if (!svc || !st || svc.tenantId !== st.tenantId) throw new DomainError('Услуга не найдена.');
  if (!svc.enabled) throw new DomainError('Вуз выключил эту услугу.');
  for (const f of svc.fields) {
    if (f.required && !p.values[f.id]?.trim()) throw new DomainError(`Заполните поле «${f.label}».`);
  }
  const at = now();
  const request: ServiceRequest = {
    id: d.nextRequestId++,
    tenantId: st.tenantId,
    serviceId: svc.id,
    studentId: st.id,
    values: p.values,
    files: p.files,
    status: 'accepted',
    channel: p.channel,
    createdAt: at,
    updatedAt: at,
    deadline: addWorkingDays(new Date(), svc.slaDays).toISOString(),
    history: [{ at, status: 'accepted', note: p.channel === 'bot' ? 'подана из бота' : 'подана из Mini App', actor: 'student' }],
  };
  d.requests.push(request);
  if (p.draftId) d.drafts = d.drafts.filter((x) => x.id !== p.draftId);
  pushMessage(d, out, botTexts.accepted(request, svc));
  pushMessage(d, out, botTexts.staffNew(request, svc, st));
  return { request, messages: out };
}

export function replyToClarification(d: DB, id: number, text: string, file?: StoredFile) {
  const out: BotMessage[] = [];
  const { r, st } = findRequest(d, id);
  if (r.status !== 'need_info') throw new DomainError('Сотрудник не запрашивал уточнение по этой заявке.');
  r.studentReply = text;
  if (file) r.files[`reply_${r.history.length}`] = file;
  r.status = 'in_progress';
  r.updatedAt = now();
  r.history.push({ at: r.updatedAt, status: 'in_progress', note: `студент дополнил: «${text}»`, actor: 'student' });
  pushMessage(d, out, botTexts.staffReplied(r, st));
  return out;
}

// ——— Сотрудник ———

export function takeInWork(d: DB, id: number) {
  const out: BotMessage[] = [];
  const { r } = findRequest(d, id);
  if (r.status !== 'accepted') return out;
  r.status = 'in_progress';
  r.updatedAt = now();
  r.history.push({ at: r.updatedAt, status: 'in_progress', note: 'взята сотрудником', actor: 'staff' });
  pushMessage(d, out, botTexts.inProgress(r));
  return out;
}

export function requestClarification(d: DB, id: number, comment: string) {
  const out: BotMessage[] = [];
  const { r } = findRequest(d, id);
  r.status = 'need_info';
  r.clarification = comment;
  r.studentReply = undefined;
  r.updatedAt = now();
  r.history.push({ at: r.updatedAt, status: 'need_info', note: 'запрошено уточнение', actor: 'staff' });
  pushMessage(d, out, botTexts.needInfo(r, comment));
  return out;
}

export function attachResult(d: DB, id: number, file: StoredFile) {
  const { r } = findRequest(d, id);
  if (r.status === 'done' || r.status === 'rejected') throw new DomainError('Заявка уже закрыта.');
  r.result = file;
  r.updatedAt = now();
}

export function detachResult(d: DB, id: number) {
  const { r } = findRequest(d, id);
  if (r.status === 'done') return;
  r.result = undefined;
  r.updatedAt = now();
}

export function completeRequest(d: DB, id: number, note?: string) {
  const out: BotMessage[] = [];
  const { r, svc } = findRequest(d, id);
  if (svc.resultType === 'pdf' && !r.result) throw new DomainError('Прикрепите готовую справку перед завершением.');
  if (svc.resultType === 'visit' && !note && !r.result) {
    throw new DomainError('Напишите, где и когда забрать результат, или прикрепите документ.');
  }
  if (note) r.resultNote = note;
  r.status = 'done';
  r.updatedAt = now();
  r.history.push({
    at: r.updatedAt, status: 'done',
    note: svc.resultType === 'pdf' ? 'справка подготовлена' : r.result ? `прикреплён документ ${r.result.name}` : note || 'заявка выполнена',
    actor: 'staff',
  });
  pushMessage(d, out, botTexts.done(r, svc));
  pushMessage(d, out, botTexts.rateAsk(r));
  return out;
}

/** Оценка студента после «Готово» (из бота или Mini App). Повторная оценка заменяет предыдущую. */
export function rateRequest(d: DB, id: number, studentId: string, score: number, comment: string | undefined, channel: 'bot' | 'miniapp') {
  const out: BotMessage[] = [];
  const { r, st } = findRequest(d, id);
  if (r.studentId !== studentId) throw new DomainError('Заявка не найдена.');
  if (r.status !== 'done') throw new DomainError('Оценить можно выполненную заявку.');
  const s = Math.round(Number(score));
  if (!(s >= 1 && s <= 5)) throw new DomainError('Оценка — от 1 до 5.');
  const text = comment?.trim().slice(0, 500) || undefined;
  const hadLow = r.rating && r.rating.score <= 3 && r.rating.comment;
  r.rating = { score: s, comment: text ?? r.rating?.comment, at: now(), channel };
  // Сотруднику сообщаем о низкой оценке с комментарием — сигнал, что процесс ломается
  if (s <= 3 && text && !hadLow) pushMessage(d, out, botTexts.staffLowRating(r, st, s, text));
  return out;
}

export function rejectRequest(d: DB, id: number, reason: string) {
  const out: BotMessage[] = [];
  const { r } = findRequest(d, id);
  r.status = 'rejected';
  r.rejectReason = reason;
  r.updatedAt = now();
  r.history.push({ at: r.updatedAt, status: 'rejected', note: `отказ: ${reason}`, actor: 'staff' });
  pushMessage(d, out, botTexts.rejected(r, reason));
  return out;
}

// ——— Администратор ———

export function setServiceEnabled(d: DB, id: string, enabled: boolean) {
  const s = d.services.find((x) => x.id === id);
  if (!s) throw new DomainError('Услуга не найдена.');
  s.enabled = enabled;
  if (enabled) s.published = true;
}

export function saveService(d: DB, svc: Service, publish: boolean) {
  const next: Service = { ...svc, published: publish || svc.published, enabled: publish ? true : svc.enabled };
  const i = d.services.findIndex((x) => x.id === svc.id);
  if (i >= 0) d.services[i] = next;
  else d.services.push(next);
  return next;
}

// ——— Бот: черновик после маршрутизации ———

export function createDraft(d: DB, studentId: string, serviceId: string, values: Record<string, string>, sourceText: string): Draft {
  const draft: Draft = { id: uid(8), studentId, serviceId, values, sourceText };
  d.drafts = d.drafts.filter((x) => x.studentId !== studentId);
  d.drafts.push(draft);
  return draft;
}

// ——— Статистика для дашборда ———

export function tenantStats(db: DB, tenantId: string) {
  const t = db.tenants.find((x) => x.id === tenantId)!;
  const reqs = db.requests.filter((r) => r.tenantId === tenantId);
  const finished = reqs.filter((r) => r.status === 'done');
  const days = finished.reduce((acc, r) => {
    const doneAt = [...r.history].reverse().find((h) => h.status === 'done')?.at ?? r.updatedAt;
    return acc + (new Date(doneAt).getTime() - new Date(r.createdAt).getTime()) / 86400000;
  }, 0);
  const processed = t.archive.processed + finished.length;
  return {
    processed,
    inWork: reqs.filter((r) => r.status === 'in_progress' || r.status === 'need_info').length,
    newCount: reqs.filter((r) => r.status === 'accepted').length,
    overdue: reqs.filter(isOverdue).length,
    avgDays: processed ? (t.archive.totalDays + days) / processed : 0,
  };
}

// ——— Обратная связь и узкие места по услугам (дашборд вуза) ———

export interface ServiceInsight {
  serviceId: string;
  total: number;
  done: number;
  overdue: number;
  needInfoShare: number; // доля заявок, где сотрудник запрашивал уточнение
  avgDays: number | null;
  ratingAvg: number | null;
  ratingCount: number;
}

export function serviceInsights(db: DB, tenantId: string): ServiceInsight[] {
  return db.services
    .filter((s) => s.tenantId === tenantId && s.published)
    .map((s) => {
      const reqs = db.requests.filter((r) => r.serviceId === s.id);
      const done = reqs.filter((r) => r.status === 'done');
      const days = done.map((r) => {
        const doneAt = [...r.history].reverse().find((h) => h.status === 'done')?.at ?? r.updatedAt;
        return (new Date(doneAt).getTime() - new Date(r.createdAt).getTime()) / 86400000;
      });
      const rated = reqs.filter((r) => r.rating);
      return {
        serviceId: s.id,
        total: reqs.length,
        done: done.length,
        overdue: reqs.filter(isOverdue).length,
        needInfoShare: reqs.length ? reqs.filter((r) => r.history.some((h) => h.status === 'need_info')).length / reqs.length : 0,
        avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
        ratingAvg: rated.length ? rated.reduce((a, r) => a + r.rating!.score, 0) / rated.length : null,
        ratingCount: rated.length,
      };
    });
}

export function tenantRating(db: DB, tenantId: string) {
  const rated = db.requests.filter((r) => r.tenantId === tenantId && r.rating);
  return {
    count: rated.length,
    avg: rated.length ? rated.reduce((a, r) => a + r.rating!.score, 0) / rated.length : null,
    lowComments: rated
      .filter((r) => r.rating!.score <= 3 && r.rating!.comment)
      .sort((a, b) => b.rating!.at.localeCompare(a.rating!.at))
      .slice(0, 4),
  };
}
