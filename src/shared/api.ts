import type { DB, Draft, Service, ServiceRequest, StoredFile } from './types';
import { getDB, update } from './store';
import * as domain from './domain';
import { routeByKeywords } from './router';
import { generateCertificatePdf } from './pdf';
import { BACKEND } from './mode';
import { http, setToken, syncPanel, syncStudent } from './backend';

// Слой «API» для экранов. Два режима:
//   BACKEND = false — демо без сервера: логика domain.ts выполняется прямо в браузере;
//   BACKEND = true  — запросы к серверу (server/index.ts), он же рассылает уведомления через бота MAX.
// Экраны вызывают только эти функции и не знают, в каком режиме работают.

// ——— Селекторы ———

export const serviceById = (db: DB, id: string) => db.services.find((s) => s.id === id);
export const studentById = (db: DB, id: string) => db.students.find((s) => s.id === id);
export const tenantById = (db: DB, id: string) => db.tenants.find((t) => t.id === id)!;
export const { isOverdue, isActive, tenantStats, serviceInsights, tenantRating } = domain;

let panelTenant = 'univ-a';
/** Панель сообщает, какой вуз открыт, — чтобы после действий обновлять нужные данные. */
export const setPanelTenant = (id: string) => {
  panelTenant = id;
};
const refreshPanel = () => syncPanel(panelTenant);

// ——— Студент ———

export async function loginStudent(tenantId: string, email: string, password: string): Promise<{ studentId: string }> {
  if (BACKEND) {
    const r = await http<{ token: string; studentId: string }>('POST', '/api/student/login', { tenantId, email, password });
    setToken('student', r.token);
    await syncStudent();
    return { studentId: r.studentId };
  }
  const st = domain.findStudentByLogin(getDB(), tenantId, email, password);
  return { studentId: st.id };
}

export function logoutStudent() {
  if (BACKEND) setToken('student', null);
}

export async function createRequest(p: domain.CreateRequestInput): Promise<ServiceRequest> {
  if (BACKEND) {
    const { request } = await http<{ request: ServiceRequest }>('POST', '/api/student/requests', p, 'student');
    await syncStudent();
    return request;
  }
  let created!: ServiceRequest;
  update((d) => {
    created = domain.createRequest(d, p).request;
  });
  return created;
}

export async function replyToClarification(id: number, text: string) {
  if (BACKEND) {
    await http('POST', `/api/student/requests/${id}/reply`, { text }, 'student');
    await syncStudent();
    return;
  }
  update((d) => void domain.replyToClarification(d, id, text));
}

export async function rateRequest(id: number, studentId: string, score: number, comment?: string) {
  if (BACKEND) {
    await http('POST', `/api/student/requests/${id}/rate`, { score, comment }, 'student');
    await syncStudent();
    return;
  }
  update((d) => void domain.rateRequest(d, id, studentId, score, comment, 'miniapp'));
}

// ——— Сотрудник ———

async function panelCall(method: string, path: string, body?: unknown) {
  await http(method, path, body, 'panel');
  await refreshPanel();
}

export async function takeInWork(id: number) {
  if (BACKEND) return panelCall('POST', `/api/panel/requests/${id}/take`);
  update((d) => void domain.takeInWork(d, id));
}

export async function requestClarification(id: number, comment: string) {
  if (BACKEND) return panelCall('POST', `/api/panel/requests/${id}/clarify`, { comment });
  update((d) => void domain.requestClarification(d, id, comment));
}

export async function attachResult(id: number, file: StoredFile) {
  if (BACKEND) {
    if (!file.dataUrl) throw new Error('Файл не прочитался. Выберите его ещё раз.');
    return panelCall('POST', `/api/panel/requests/${id}/result`, { file: { name: file.name, mime: file.mime, size: file.size, dataUrl: file.dataUrl } });
  }
  update((d) => domain.attachResult(d, id, file));
}

export async function detachResult(id: number) {
  if (BACKEND) return panelCall('DELETE', `/api/panel/requests/${id}/result`);
  update((d) => domain.detachResult(d, id));
}

/**
 * Справка по шаблону вуза.
 * С сервером — настоящий PDF со штампом электронной подписи и QR-кодом проверки (server/certificate.ts).
 * В демо без сервера — PDF собирается в браузере.
 */
export async function generateResult(id: number) {
  if (BACKEND) return panelCall('POST', `/api/panel/requests/${id}/generate`);
  const d = getDB();
  const r = d.requests.find((x) => x.id === id);
  if (!r) throw new Error(`Заявка №${id} не найдена`);
  const svc = serviceById(d, r.serviceId)!;
  const st = studentById(d, r.studentId)!;
  await attachResult(id, generateCertificatePdf(r, st, tenantById(d, r.tenantId), svc));
}

export async function completeRequest(id: number, note?: string) {
  if (BACKEND) return panelCall('POST', `/api/panel/requests/${id}/complete`, { note });
  update((d) => void domain.completeRequest(d, id, note));
}

export async function rejectRequest(id: number, reason: string) {
  if (BACKEND) return panelCall('POST', `/api/panel/requests/${id}/reject`, { reason });
  update((d) => void domain.rejectRequest(d, id, reason));
}

// ——— Администратор ———

export async function setServiceEnabled(id: string, enabled: boolean) {
  if (BACKEND) return panelCall('POST', `/api/panel/services/${encodeURIComponent(id)}/enabled`, { enabled });
  update((d) => domain.setServiceEnabled(d, id, enabled));
}

export async function saveService(svc: Service, publish: boolean) {
  if (BACKEND) return panelCall('PUT', '/api/panel/services', { service: svc, publish });
  update((d) => void domain.saveService(d, svc, publish));
}

// ——— Демо-стенд: симуляция бота без сервера ———

export function routeMessageLocal(tenantId: string, text: string) {
  return routeByKeywords(getDB().services.filter((s) => s.tenantId === tenantId), text);
}

export function createDraftLocal(studentId: string, serviceId: string, values: Record<string, string>, sourceText: string): Draft {
  let draft!: Draft;
  update((d) => {
    draft = domain.createDraft(d, studentId, serviceId, values, sourceText);
  });
  return draft;
}
