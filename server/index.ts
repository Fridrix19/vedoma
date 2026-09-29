import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DB, Service, StoredFile } from '../src/shared/types';
import * as domain from '../src/shared/domain';
import { config } from './config';
import { getDB, mutate } from './db';
import { makeToken, readToken, validateInitData } from './auth';
import { pathFromUrl, persistFile } from './files';
import { deliver, getBotInfo, notifyLinked, startBot } from './bot';
import { routerEngine } from './router-llm';
import { issueCertificate, signUploaded, verifyDocument } from './documents';
import { keyId, publicKeyPem } from './signing';
import { verifyPage } from './verify-page';

// Сервер UniFlow: API для Mini App и панели + раздача собранного фронта + бот MAX.

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// ——— Утилиты ———

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    const known = e instanceof domain.DomainError || (e as Error).message?.startsWith('Файл');
    if (!known) console.error('[api]', e);
    res.status(known ? 400 : 500).json({ error: known ? (e as Error).message : 'Ошибка сервера. Попробуйте ещё раз.' });
  }
};

const initDataOf = (req: Request) => validateInitData(req.header('x-max-init-data') ?? undefined, config.botToken);

/** Данные, которые видит студент: только своё. */
function studentState(d: DB, studentId: string) {
  const st = d.students.find((s) => s.id === studentId)!;
  return {
    tenants: d.tenants.filter((t) => t.id === st.tenantId),
    students: [st],
    services: d.services.filter((s) => s.tenantId === st.tenantId),
    requests: d.requests.filter((r) => r.studentId === st.id),
    messages: d.messages.filter((m) => m.audience === 'student' && m.studentId === st.id),
    drafts: d.drafts.filter((x) => x.studentId === st.id),
  };
}

/** Данные панели: всё по одному вузу. */
function panelState(d: DB, tenantId: string) {
  return {
    tenants: d.tenants,
    students: d.students.filter((s) => s.tenantId === tenantId).map(({ maxUserId, ...s }) => ({ ...s, maxLinked: Boolean(maxUserId) })),
    services: d.services.filter((s) => s.tenantId === tenantId),
    requests: d.requests.filter((r) => r.tenantId === tenantId),
    messages: d.messages.filter((m) => m.tenantId === tenantId),
    drafts: [],
    staffCount: (d.staff ?? []).filter((s) => s.tenantId === tenantId).length,
    bot: getBotInfo(),
  };
}

// ——— Публичное ———

app.get('/api/health', (_req, res) => res.json({ ok: true, bot: getBotInfo(), router: routerEngine() }));

app.get('/api/public/tenants', (_req, res) => {
  const d = getDB();
  res.json({
    tenants: d.tenants.map((t) => ({
      id: t.id, name: t.name, short: t.short,
      // Подсказка логина для демо (в реальном вузе — SSO)
      demoEmail: d.students.find((s) => s.tenantId === t.id)?.email ?? '',
    })),
    browserLogin: config.allowBrowserLogin,
  });
});

// ——— Студент ———

app.post('/api/student/session', h((req, res) => {
  const init = initDataOf(req);
  const st = init?.user ? getDB().students.find((s) => s.maxUserId === init.user!.id) : undefined;
  if (!st) {
    res.status(401).json({ error: 'need_login', insideMax: Boolean(init) });
    return;
  }
  return { token: makeToken('student', st.id), studentId: st.id, startParam: init?.start_param ?? null };
}));

app.post('/api/student/login', h(async (req, res) => {
  const { tenantId, email, password } = req.body ?? {};
  const init = initDataOf(req);
  if (!init && !config.allowBrowserLogin) {
    res.status(403).json({ error: 'Откройте приложение из бота в MAX.' });
    return;
  }
  const st = domain.findStudentByLogin(getDB(), String(tenantId), String(email ?? ''), String(password ?? ''));
  let linked = false;
  if (init?.user) {
    const maxId = init.user.id;
    mutate((d) => {
      d.students.forEach((s) => { if (s.maxUserId === maxId) s.maxUserId = undefined; });
      d.students.find((s) => s.id === st.id)!.maxUserId = maxId;
    });
    linked = true;
    void notifyLinked(getDB().students.find((s) => s.id === st.id)!);
  }
  return { token: makeToken('student', st.id), studentId: st.id, linked };
}));

function studentAuth(req: Request, res: Response, next: NextFunction) {
  const id = readToken(req.header('x-session') ?? undefined, 'student');
  if (!id || !getDB().students.some((s) => s.id === id)) {
    res.status(401).json({ error: 'need_login' });
    return;
  }
  res.locals.studentId = id;
  next();
}

app.get('/api/student/state', studentAuth, (_req, res) => res.json(studentState(getDB(), res.locals.studentId)));

app.post('/api/student/requests', studentAuth, h(async (req, res) => {
  const { serviceId, values, files, channel, draftId } = req.body ?? {};
  const stored: Record<string, StoredFile> = {};
  for (const [k, f] of Object.entries((files ?? {}) as Record<string, StoredFile>)) stored[k] = persistFile(f);
  const { request, messages } = mutate((d) =>
    domain.createRequest(d, {
      studentId: res.locals.studentId, serviceId: String(serviceId), values: values ?? {}, files: stored,
      channel: channel === 'bot' ? 'bot' : 'miniapp', draftId,
    }),
  );
  void deliver(messages);
  return { request };
}));

app.post('/api/student/requests/:id/reply', studentAuth, h((req, res) => {
  const id = Number(req.params.id);
  const r = getDB().requests.find((x) => x.id === id);
  if (!r || r.studentId !== res.locals.studentId) throw new domain.DomainError('Заявка не найдена.');
  const text = String(req.body?.text ?? '').trim();
  if (!text) throw new domain.DomainError('Напишите ответ сотруднику.');
  void deliver(mutate((d) => domain.replyToClarification(d, id, text)));
}));

app.post('/api/student/requests/:id/rate', studentAuth, h((req, res) => {
  const id = Number(req.params.id);
  const score = Number(req.body?.score);
  const comment = req.body?.comment ? String(req.body.comment) : undefined;
  void deliver(mutate((d) => domain.rateRequest(d, id, res.locals.studentId, score, comment, 'miniapp')));
}));

// ——— Панель вуза ———

app.post('/api/panel/login', h((req, res) => {
  if (String(req.body?.password ?? '') !== config.panelPassword) {
    res.status(401).json({ error: 'Неверный пароль панели.' });
    return;
  }
  return { token: makeToken('panel', 'staff') };
}));

function panelAuth(req: Request, res: Response, next: NextFunction) {
  if (!readToken(req.header('x-panel-token') ?? undefined, 'panel')) {
    res.status(401).json({ error: 'need_login' });
    return;
  }
  next();
}

app.get('/api/panel/state', panelAuth, (req, res) => {
  const d = getDB();
  const tenantId = String(req.query.tenantId ?? d.tenants[0].id);
  res.json(panelState(d, d.tenants.some((t) => t.id === tenantId) ? tenantId : d.tenants[0].id));
});

const reqId = (req: Request) => Number(req.params.id);

app.post('/api/panel/requests/:id/take', panelAuth, h((req) => void deliver(mutate((d) => domain.takeInWork(d, reqId(req))))));
app.post('/api/panel/requests/:id/clarify', panelAuth, h((req) => {
  const comment = String(req.body?.comment ?? '').trim();
  if (!comment) throw new domain.DomainError('Напишите, что уточнить.');
  void deliver(mutate((d) => domain.requestClarification(d, reqId(req), comment)));
}));
/** Заявку можно дополнить результатом, только пока она открыта. */
function assertOpen(id: number) {
  const r = getDB().requests.find((x) => x.id === id);
  if (!r) throw new domain.DomainError(`Заявка №${id} не найдена`);
  if (r.status === 'done' || r.status === 'rejected') throw new domain.DomainError('Заявка уже закрыта.');
}

// Загрузить свой файл. PDF подписывается электронной подписью вуза.
app.post('/api/panel/requests/:id/result', panelAuth, h(async (req) => {
  assertOpen(reqId(req));
  const file = await signUploaded(getDB(), reqId(req), persistFile(req.body?.file));
  mutate((d) => domain.attachResult(d, reqId(req), file));
  return { ok: true, file };
}));
// Сформировать справку по шаблону вуза: PDF + штамп ЭП + QR-код проверки.
app.post('/api/panel/requests/:id/generate', panelAuth, h(async (req) => {
  assertOpen(reqId(req));
  const file = await issueCertificate(getDB(), reqId(req));
  mutate((d) => domain.attachResult(d, reqId(req), file));
  return { ok: true, file };
}));
app.delete('/api/panel/requests/:id/result', panelAuth, h((req) => mutate((d) => domain.detachResult(d, reqId(req)))));
app.post('/api/panel/requests/:id/complete', panelAuth, h((req) => {
  const note = String(req.body?.note ?? '').trim() || undefined;
  void deliver(mutate((d) => domain.completeRequest(d, reqId(req), note)));
}));
app.post('/api/panel/requests/:id/reject', panelAuth, h((req) => {
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) throw new domain.DomainError('Укажите причину отказа.');
  void deliver(mutate((d) => domain.rejectRequest(d, reqId(req), reason)));
}));
app.post('/api/panel/services/:id/enabled', panelAuth, h((req) =>
  mutate((d) => domain.setServiceEnabled(d, req.params.id, Boolean(req.body?.enabled))),
));
app.put('/api/panel/services', panelAuth, h((req) => {
  const svc = req.body?.service as Service;
  if (!svc?.id || !svc.title || !svc.tenantId) throw new domain.DomainError('Заполните название услуги.');
  return { service: mutate((d) => domain.saveService(d, svc, Boolean(req.body?.publish))) };
}));

// ——— Файлы ———

// ——— Проверка подлинности документов (QR-код в справке) ———

app.get('/api/public/verify/:docId', (req, res) => {
  const v = verifyDocument(getDB(), req.params.docId);
  if (!v) {
    res.status(404).json({ error: 'Документ с таким номером не найден' });
    return;
  }
  res.json(v);
});
app.get('/api/public/signing-key', (_req, res) => res.json({ alg: 'Ed25519', keyId, publicKeyPem }));
app.get('/verify/:docId', (req, res) => {
  const v = verifyDocument(getDB(), req.params.docId);
  res.status(v ? 200 : 404).type('html').send(verifyPage(req.params.docId, v));
});

app.get('/files/:id/:name', (req, res) => {
  const p = pathFromUrl(`/files/${req.params.id}/${encodeURIComponent(req.params.name)}`);
  if (!p) {
    res.status(404).send('Файл не найден');
    return;
  }
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(req.params.name)}`);
  res.sendFile(p);
});

// ——— Фронт (npm run build) ———

if (existsSync(config.distDir)) {
  app.get('/', (_req, res) => res.redirect('/panel.html'));
  app.use(express.static(config.distDir, { index: false }));
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('Фронт не собран. Выполните «npm run build», затем перезапустите сервер.'),
  );
}

app.listen(config.port, () => {
  console.log(`[server] UniFlow запущен: http://localhost:${config.port}`);
  console.log(`[server] Mini App: ${config.publicUrl || `http://localhost:${config.port}`}/miniapp.html`);
  console.log(`[server] Панель:   ${config.publicUrl || `http://localhost:${config.port}`}/panel.html  (пароль из PANEL_PASSWORD)`);
  if (!config.publicUrl) console.warn('[server] PUBLIC_URL не задан — укажите https-адрес туннеля/хостинга, чтобы открыть Mini App из MAX.');
  if (!existsSync(join(config.distDir, 'miniapp.html'))) console.warn('[server] Нет dist/miniapp.html — выполните «npm run build».');
});

void startBot();
