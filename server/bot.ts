import { Bot, Keyboard, type Context } from '@maxhub/max-bot-api';
import type { BotMessage, DB, Service, Student } from '../src/shared/types';
import { STATUS_LABEL } from '../src/shared/types';
import { createDraft, DomainError, isActive, rateRequest } from '../src/shared/domain';
import { ddmm, pluralDays } from '../src/shared/dates';
import { config } from './config';
import { getDB, mutate } from './db';
import { pathFromUrl } from './files';
import { understandMessage } from './router-llm';
import { prefillFor } from '../src/shared/router';

// Бот MAX: диалог со студентом (задача 1.1) и уведомления студенту и деканату.
// Работает через long polling — публичный адрес для самого бота не нужен.

let bot: Bot | null = null;
/** Кто из студентов сейчас пишет комментарий к низкой оценке: maxUserId → номер заявки. */
const pendingComment = new Map<number, number>();
let botUsername = config.botUsername;
let botId: number | undefined;

type Btn = Parameters<typeof Keyboard.inlineKeyboard>[0][number][number];

/** Кнопка, открывающая Mini App с параметром запуска. */
function appButton(text: string, startParam: string): Btn {
  if (config.openAppButtons && botUsername) {
    return Keyboard.button.openApp(text, botUsername, botId, startParam) as unknown as Btn;
  }
  return Keyboard.button.link(text, `https://max.ru/${botUsername}?startapp=${encodeURIComponent(startParam)}`);
}

const kb = (...rows: Btn[][]) => Keyboard.inlineKeyboard(rows);

const studentByMax = (d: DB, userId: number | undefined) =>
  userId ? d.students.find((s) => s.maxUserId === userId) : undefined;

const greetUnknown =
  'Здравствуйте! Я Ведома — бот-помощник для студента.\n\n' +
  'Оформлю справки, академ, матпомощь и запись в деканат.\n\n' +
  'Войдите через вуз — поля ФИО и группы подставятся сами.\n\n' +
  'Демо-версия: вузы и студенты тестовые.';

const greetKnown = (st: Student) =>
  `Здравствуйте, ${st.firstName}! Напишите, что нужно, — например, «справка для банка». Или откройте каталог.`;

/** Кнопки входа для непривязанного пользователя. */
const loginKb = () =>
  config.demoBotLogin
    ? kb([appButton('Войти через ВУЗ', 'login')], [Keyboard.button.callback('Демо-вход: тестовый студент', 'demo')])
    : kb([appButton('Войти через ВУЗ', 'login')]);

async function sendGreeting(ctx: Context, userId: number | undefined) {
  const st = studentByMax(getDB(), userId);
  if (!st) {
    await ctx.reply(greetUnknown, { attachments: [loginKb()] });
    return;
  }
  await ctx.reply(greetKnown(st), {
    attachments: [kb([appButton('Открыть Mini App', 'home')], [Keyboard.button.callback('Мои заявки', 'my')])],
  });
}

async function sendMyRequests(ctx: Context, userId: number | undefined) {
  const d = getDB();
  const st = studentByMax(d, userId);
  if (!st) return sendGreeting(ctx, userId);
  const mine = d.requests
    .filter((r) => r.studentId === st.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  if (!mine.length) {
    await ctx.reply('Заявок пока нет. Напишите, что нужно, или откройте каталог.', {
      attachments: [kb([appButton('Каталог услуг', 'home')])],
    });
    return;
  }
  const lines = mine.map((r) => {
    const svc = d.services.find((s) => s.id === r.serviceId);
    return `№${r.id} · ${svc?.title ?? 'Заявка'} — ${STATUS_LABEL[r.status]}${isActive(r) ? `, срок до ${ddmm(r.deadline)}` : ''}`;
  });
  await ctx.reply(`Ваши заявки:\n${lines.join('\n')}`, { attachments: [kb([appButton('Мои заявки в Mini App', 'requests')])] });
}

/** Уточняющий диалог: пока бот выясняет услугу и обязательные поля-списки. maxUserId → состояние. */
interface Clarify {
  text: string;
  serviceId?: string;
  values: Record<string, string>;
  options?: string[]; // id услуг, из которых студент выбирает
  asked?: boolean; // бот уже задавал уточняющие вопросы
  at: number;
}
const clarifying = new Map<number, Clarify>();
const CLARIFY_TTL = 30 * 60 * 1000;

/** Как бот спрашивает про поле-список. */
const FIELD_QUESTION: Record<string, string> = {
  place: 'Куда нужна справка?',
  basis: 'Какое основание?',
  kind: 'Что именно нужно?',
};
const fieldQuestion = (label: string, id: string) => FIELD_QUESTION[id] ?? `Уточните: ${label.toLowerCase()}?`;

/** Список услуг вуза для ответов бота. */
function catalogLines(services: Service[]) {
  return services
    .filter((s) => s.enabled && s.published)
    .map((s) => `• ${s.title} — до ${s.slaDays} ${pluralDays(s.slaDays)}`)
    .join('\n');
}

async function handleText(ctx: Context, userId: number, text: string) {
  const d = getDB();
  const st = studentByMax(d, userId);
  clarifying.delete(userId); // новое сообщение — новый запрос
  const tenantId = st?.tenantId ?? d.tenants[0]?.id;
  const tenant = d.tenants.find((t) => t.id === tenantId);
  const services = d.services.filter((s) => s.tenantId === tenantId);
  const u = await understandMessage(services, text);
  console.log(`[bot] «${text.slice(0, 60)}» → ${u.intent}${u.route ? ` / ${u.route.service.id}` : ''} (${u.engine})`);

  if (!st) {
    if (u.intent === 'thanks') await ctx.reply('Пожалуйста! Если что-то понадобится — пишите.');
    else if (u.intent === 'greeting' || u.intent === 'help') await ctx.reply(greetUnknown, { attachments: [loginKb()] });
    else await ctx.reply('Чтобы оформить заявку, сначала войдите через вуз — это займёт полминуты.', { attachments: [loginKb()] });
    return;
  }

  const menu = kb([appButton('Каталог услуг', 'home')], [Keyboard.button.callback('Мои заявки', 'my')]);
  switch (u.intent) {
    case 'greeting':
      await ctx.reply(
        `Привет, ${st.firstName}! Я Ведома — помощник студентов ${tenant?.short ?? 'вуза'}.\n\n` +
          `Помогу оформить:\n${catalogLines(services)}\n\n` +
          'Просто напишите своими словами, что нужно, например «справка для банка», — остальное уточню сам.',
        { attachments: [menu] },
      );
      return;
    case 'help':
      await ctx.reply(
        `Я Ведома — бот-помощник ${tenant?.name ?? 'вуза'}.\n\n` +
          'Как это работает:\n1. Вы пишете своими словами, что нужно.\n2. Я понимаю, какая это услуга, и уточняю недостающее кнопками.\n' +
          '3. Вы подтверждаете заявку, а результат (например, PDF-справка) приходит сюда же.\n\n' +
          `Что можно оформить:\n${catalogLines(services)}\n\nСтатус заявок — спросите «где моя справка?» или нажмите «Мои заявки».`,
        { attachments: [menu] },
      );
      return;
    case 'thanks':
      await ctx.reply(`Пожалуйста, ${st.firstName}! Если понадобится что-то ещё — просто напишите.`);
      return;
    case 'status':
      await sendMyRequests(ctx, userId);
      return;
    case 'other':
      await ctx.reply(
        `С этим я не помогу — я занимаюсь услугами вуза:\n${catalogLines(services)}\n\nОпишите, что нужно, или откройте каталог.`,
        { attachments: [menu] },
      );
      return;
  }
  const routed = u.route!;
  // Запрос неоднозначный — просим выбрать услугу
  if (routed.alternatives?.length) {
    clarifying.set(userId, { text, values: {}, options: routed.alternatives.map((s) => s.id), at: Date.now() });
    await ctx.reply('Уточните, что именно нужно?', {
      attachments: [
        kb(
          ...routed.alternatives.map((s) => [Keyboard.button.callback(s.title, `pick:${s.id}`)]),
          [Keyboard.button.callback('Другое', 'other')],
        ),
      ],
    });
    return;
  }
  clarifying.set(userId, { text, serviceId: routed.service.id, values: { ...routed.prefill }, at: Date.now() });
  await continueClarify(ctx, userId);
}

/** Задаёт следующий уточняющий вопрос или, если всё известно, создаёт черновик и даёт кнопку «Оформить». */
async function continueClarify(ctx: Context, userId: number) {
  const c = clarifying.get(userId);
  const d = getDB();
  const st = studentByMax(d, userId);
  const svc = d.services.find((s) => s.id === c?.serviceId);
  if (!c || !st || !svc || Date.now() - c.at > CLARIFY_TTL) {
    clarifying.delete(userId);
    await ctx.reply('Напишите, что нужно, ещё раз — например, «справка для банка».');
    return;
  }
  // Первое незаполненное обязательное поле-список — спрашиваем кнопками
  const missing = svc.fields.find((f) => f.required && f.type === 'select' && f.options?.length && !c.values[f.id]);
  if (missing) {
    const q = fieldQuestion(missing.label, missing.id);
    const head = c.asked ? q : `${intro(svc)}\n${q}`;
    c.asked = true;
    await ctx.reply(head, {
      attachments: [
        kb(...missing.options!.map((o, i) => [Keyboard.button.callback(o, `fill:${missing.id}:${i}`)])),
      ],
    });
    return;
  }
  clarifying.delete(userId);
  const draft = mutate((dd) => createDraft(dd, st.id, svc.id, c.values, c.text));
  const filled = svc.fields
    .filter((f) => c.values[f.id])
    .map((f) => `${f.label}: ${c.values[f.id]}`);
  const rest = svc.fields.some((f) => f.required && !c.values[f.id]) ? '\nОстальное заполните в форме.' : '';
  const title = c.asked ? `Отлично, заявка «${svc.title}» почти готова.` : intro(svc);
  await ctx.reply(
    `${title}\n${filled.length ? filled.join('\n') + '\n' : ''}Обычно готовится до ${svc.slaDays} ${pluralDays(svc.slaDays)}.${rest}`,
    {
      attachments: [
        kb([appButton('Оформить', `draft_${draft.id}`)], [Keyboard.button.callback('Это другая услуга', 'other')]),
      ],
    },
  );
}

const intro = (svc: Service) =>
  /^справк/i.test(svc.title) ? `Похоже, вам нужна ${svc.title.toLowerCase()}.` : `Похоже, вам подходит услуга «${svc.title}».`;

function registerHandlers(b: Bot) {
  b.on('bot_started', (ctx) => sendGreeting(ctx, ctx.user?.user_id));

  b.command(/^start(\s|$)/, (ctx) => sendGreeting(ctx, ctx.message?.sender?.user_id));
  b.command(/^my(\s|$)/, (ctx) => sendMyRequests(ctx, ctx.message?.sender?.user_id));
  b.command(/^id(\s|$)/, (ctx) => ctx.reply(`Ваш user_id в MAX: ${ctx.message?.sender?.user_id}`));

  // «/staff КОД» — сотрудник подписывается на уведомления деканата («/staff КОД univ-b» — для другого вуза)
  b.command(/^staff(\s|$)/, async (ctx) => {
    const sender = ctx.message?.sender;
    const [, code, tenantArg] = (ctx.message?.body.text ?? '').trim().split(/\s+/);
    if (!sender || code !== config.staffCode) {
      await ctx.reply('Неверный код. Спросите его у администратора панели.');
      return;
    }
    const d = getDB();
    const tenant = d.tenants.find((t) => t.id === tenantArg) ?? d.tenants[0];
    mutate((dd) => {
      dd.staff = (dd.staff ?? []).filter((s) => !(s.maxUserId === sender.user_id && s.tenantId === tenant.id));
      dd.staff.push({ tenantId: tenant.id, maxUserId: sender.user_id, name: sender.first_name ?? sender.name });
    });
    await ctx.reply(`Готово. Уведомления о новых заявках (${tenant.name}) будут приходить сюда.`);
  });

  b.action('my', async (ctx) => {
    await answerCallback(ctx);
    await sendMyRequests(ctx, ctx.user?.user_id);
  });
  // Демо-вход: выбрать тестового студента прямо в боте (данные тестовые, SSO вуза замокан)
  b.action('demo', async (ctx) => {
    await answerCallback(ctx);
    if (!config.demoBotLogin) return;
    const d = getDB();
    const rows = d.students.map((s) => {
      const t = d.tenants.find((x) => x.id === s.tenantId);
      return [Keyboard.button.callback(`${s.firstName} ${s.lastName} · ${t?.short ?? ''}`, `demo:${s.id}`)];
    });
    await ctx.reply('Демо-режим: выберите тестового студента. Все данные вымышленные.', { attachments: [kb(...rows)] });
  });
  b.action(/^demo:(.+)$/, async (ctx) => {
    await answerCallback(ctx);
    const userId = ctx.user?.user_id;
    const studentId = ctx.match?.[1];
    if (!config.demoBotLogin || !userId || !getDB().students.some((s) => s.id === studentId)) return;
    mutate((d) => {
      d.students.forEach((s) => { if (s.maxUserId === userId) s.maxUserId = undefined; });
      d.students.find((s) => s.id === studentId)!.maxUserId = userId;
    });
    const st = getDB().students.find((s) => s.id === studentId)!;
    await notifyLinked(st);
  });

  // Уточнения: выбор услуги и значения поля-списка
  b.action(/^pick:(.+)$/, async (ctx) => {
    await answerCallback(ctx);
    const userId = ctx.user?.user_id;
    const c = userId ? clarifying.get(userId) : undefined;
    const serviceId = ctx.match?.[1];
    if (!userId || !c || !serviceId || !c.options?.includes(serviceId)) {
      await ctx.reply('Напишите, что нужно, ещё раз — например, «справка для банка».');
      return;
    }
    const svc = getDB().services.find((s) => s.id === serviceId);
    c.serviceId = serviceId;
    c.options = undefined;
    c.asked = true;
    c.values = svc ? prefillFor(svc, c.text.toLowerCase()) : {};
    await continueClarify(ctx, userId);
  });
  b.action(/^fill:([^:]+):(\d+)$/, async (ctx) => {
    await answerCallback(ctx);
    const userId = ctx.user?.user_id;
    const c = userId ? clarifying.get(userId) : undefined;
    const [, fieldId, idx] = ctx.match ?? [];
    const svc = getDB().services.find((s) => s.id === c?.serviceId);
    const opt = svc?.fields.find((f) => f.id === fieldId)?.options?.[Number(idx)];
    if (!userId || !c || !opt) {
      await ctx.reply('Напишите, что нужно, ещё раз — например, «справка для банка».');
      return;
    }
    c.values[fieldId] = opt;
    await continueClarify(ctx, userId);
  });

  b.action('other', async (ctx) => {
    await answerCallback(ctx);
    if (ctx.user?.user_id) clarifying.delete(ctx.user.user_id);
    await ctx.reply('Уточните, что нужно, или выберите услугу в каталоге.', {
      attachments: [kb([appButton('Каталог услуг', 'home')])],
    });
  });

  // Оценка услуги: кнопки 1–5 под сообщением «Оцените…» (payload rate:<заявка>:<оценка>)
  b.action(/^rate:(\d+):([1-5])$/, async (ctx) => {
    await answerCallback(ctx);
    const userId = ctx.user?.user_id;
    const st = studentByMax(getDB(), userId);
    const [, idStr, scoreStr] = ctx.match ?? [];
    if (!st || !idStr) return;
    const id = Number(idStr);
    const score = Number(scoreStr);
    try {
      const out = mutate((d) => rateRequest(d, id, st.id, score, undefined, 'bot'));
      void deliver(out);
    } catch (e) {
      await ctx.reply(e instanceof DomainError ? e.message : 'Не получилось сохранить оценку.');
      return;
    }
    if (score <= 3) {
      pendingComment.set(userId!, id);
      await ctx.reply(`Спасибо, оценка ${score}/5 сохранена. Что пошло не так? Напишите одним сообщением — это увидит вуз.`);
    } else {
      await ctx.reply(`Спасибо, оценка ${score}/5 сохранена!`);
    }
  });

  b.on('message_created', async (ctx) => {
    const msg = ctx.message;
    if (!msg?.sender || msg.sender.is_bot) return;
    if (msg.recipient.chat_type !== 'dialog') return;
    const text = msg.body.text?.trim();
    if (!text || text.startsWith('/')) return;
    // Комментарий к низкой оценке
    const pending = pendingComment.get(msg.sender.user_id);
    if (pending) {
      pendingComment.delete(msg.sender.user_id);
      const st = studentByMax(getDB(), msg.sender.user_id);
      const r = getDB().requests.find((x) => x.id === pending);
      if (st && r?.rating) {
        void deliver(mutate((d) => rateRequest(d, pending, st.id, r.rating!.score, text, 'bot')));
        await ctx.reply('Спасибо! Передали ваш комментарий в вуз.');
        return;
      }
    }
    await handleText(ctx, msg.sender.user_id, text);
  });
}

async function answerCallback(ctx: Context) {
  const id = ctx.callback?.callback_id;
  if (!id) return;
  try {
    await ctx.api.answerOnCallback(id, { notification: 'Готово' } as never);
  } catch {
    /* ответ на callback необязателен */
  }
}

// ——— Исходящие уведомления ———

export async function deliver(messages: BotMessage[]) {
  if (!bot) return;
  for (const m of messages) {
    try {
      await deliverOne(m);
    } catch (e) {
      console.error(`[bot] Не удалось отправить сообщение по заявке №${m.requestId}:`, (e as Error).message);
    }
  }
}

async function deliverOne(m: BotMessage) {
  const d = getDB();
  const r = d.requests.find((x) => x.id === m.requestId);
  if (m.audience === 'student') {
    const st = d.students.find((s) => s.id === m.studentId);
    if (!st?.maxUserId) return; // студент не привязал MAX — увидит статус в Mini App
    const attachments: object[] = [];
    if (m.buttons.some((b) => b.action === 'download_pdf') && r?.result) {
      const path = pathFromUrl(r.result.url);
      if (path) {
        const file = await bot!.api.uploadFile({ source: path });
        attachments.push(file.toJson());
      }
    }
    const rate = m.buttons.filter((b) => b.action === 'rate');
    if (rate.length) {
      attachments.push(kb(rate.map((b) => Keyboard.button.callback(b.label, `rate:${m.requestId}:${b.value}`))));
    } else {
      const btnText = m.buttons.find((b) => b.action === 'reply') ? 'Дополнить заявку' : 'Открыть заявку';
      const rows: Btn[][] = [[appButton(btnText, `req_${m.requestId}`)]];
      // Документ с электронной подписью — кнопка на страницу проверки подлинности
      const sig = m.buttons.some((b) => b.action === 'download_pdf') ? r?.result?.signature : undefined;
      if (sig && config.publicUrl.startsWith('https://')) {
        rows.push([Keyboard.button.link('Проверить подпись', `${config.publicUrl}/verify/${sig.docId}`)]);
      }
      attachments.push(kb(...rows));
    }
    await bot!.api.sendMessageToUser(st.maxUserId, m.text, { attachments: attachments as never });
    return;
  }
  // Деканат
  const staff = (d.staff ?? []).filter((s) => s.tenantId === m.tenantId);
  const panelLink = config.publicUrl.startsWith('https://')
    ? [kb([Keyboard.button.link('Открыть заявку', `${config.publicUrl}/panel.html#req-${m.requestId}`)])]
    : [];
  for (const s of staff) {
    await bot!.api.sendMessageToUser(s.maxUserId, m.text, { attachments: panelLink as never });
  }
}

/** Отправка приветствия после привязки профиля в Mini App. */
export async function notifyLinked(st: Student) {
  if (!bot || !st.maxUserId) return;
  const t = getDB().tenants.find((x) => x.id === st.tenantId);
  try {
    await bot.api.sendMessageToUser(
      st.maxUserId,
      `Готово! Профиль привязан.\n\n${st.firstName} ${st.lastName}\n${t?.short ?? ''} · Факультет ${st.faculty} · группа ${st.group}\n\nНапишите, что нужно, или откройте каталог.`,
      { attachments: [kb([appButton('Открыть Mini App', 'home')], [Keyboard.button.callback('Мои заявки', 'my')])] as never },
    );
  } catch (e) {
    console.error('[bot] Не удалось отправить приветствие:', (e as Error).message);
  }
}

export function getBotInfo() {
  return { enabled: Boolean(bot), username: botUsername, id: botId };
}

export async function startBot() {
  if (!config.botToken) {
    console.warn('[bot] BOT_TOKEN не задан — сервер работает без бота (только Mini App и панель).');
    return;
  }
  bot = new Bot(config.botToken, config.maxApiUrl ? { clientOptions: { baseUrl: config.maxApiUrl } } : undefined);
  bot.catch((err) => console.error('[bot] Ошибка обработки события:', err));
  registerHandlers(bot);
  try {
    const me = await bot.api.getMyInfo();
    botId = me.user_id;
    botUsername ||= me.username ?? '';
    console.log(`[bot] Подключён: ${me.first_name ?? me.name} (@${botUsername}), id ${botId}`);
    if (!botUsername) console.warn('[bot] У бота нет username — укажите BOT_USERNAME в .env, иначе ссылки на Mini App не соберутся.');
    await bot.api.setMyCommands([
      { name: 'start', description: 'Начать' },
      { name: 'my', description: 'Мои заявки' },
      { name: 'staff', description: 'Для сотрудников: /staff КОД' },
    ]);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[bot] Не удалось подключиться к MAX: ${msg}`);
    if (/certificate|UNABLE_TO_GET_ISSUER|self.signed/i.test(msg + String((e as { cause?: unknown }).cause ?? ''))) {
      console.error('[bot] Похоже на проблему с сертификатом Минцифры. Запускайте сервер через «npm start» — он подключает certs/russian_trusted_root_ca.pem.');
    }
    bot = null;
    return;
  }
  bot.start().catch((e) => console.error('[bot] Long polling остановлен:', e));
}
