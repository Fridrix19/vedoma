import type { Service } from '../src/shared/types';
import { prefillFor, type Intent, type RouteResult, type Understanding } from '../src/shared/router';
import { config } from './config';

// Маршрутизатор на Jev (TypeSafe AI, «System One»).
// Jev не пишет текст — он отвечает на типизированные вопросы (noul / choice / score) с вероятностями.
// Поэтому одним запросом спрашиваем:
//   intent             — что хочет студент: оформить услугу, поздороваться, спросить про статус…;
//   service            — какая услуга нужна (choice по каталогу вуза + «other»);
//   f__<услуга>__<поле> — что студент уже сказал про каждое поле-список (choice по вариантам + «none»).
// Всё, что Jev не определил уверенно, бот уточняет у студента кнопками (см. server/bot.ts).
// Контракт: https://docs.typesafe.ai/introduction/quickstart , https://docs.typesafe.ai/primitives/choice

interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
interface JevResponse {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Порог, начиная с которого считаем ответ Jev уверенным. */
const SURE = 0.6;
/** Варианты услуги с вероятностью выше этого предлагаем студенту, если Jev не уверен. */
const MAYBE = 0.15;

const fieldKey = (svcIdx: number, fieldId: string) => `f__${svcIdx}__${fieldId}`.replace(/[^A-Za-z0-9_]/g, '_');

export const jevEnabled = () => Boolean(config.jev.key);

/** Расход последнего запроса (Polza.AI добавляет cost_rub) — для npm run jev:check. */
export let lastJevUsage: JevResponse['usage'] & { cost_rub?: number } = undefined as never;

export async function askJev(state: string, questions: Record<string, ChoiceQuestion>): Promise<JevResponse> {
  const res = await fetch(config.jev.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.jev.key}` },
    body: JSON.stringify({ model: config.jev.model, state, questions }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as JevResponse;
}

/** Намерения студента для вопроса intent. */
const INTENTS: Record<Intent, string> = {
  request:
    'Просит оформить документ или услугу вуза, либо описывает проблему, с которой нужна помощь вуза (справка, академ, деньги, декан, общежитие)',
  greeting: 'Просто приветствие без конкретной просьбы: привет, здравствуйте, добрый день',
  thanks: 'Благодарность или прощание: спасибо, пока, до свидания',
  help: 'Спрашивает, кто это, что умеет бот, чем может помочь, как пользоваться',
  status: 'Спрашивает о своих уже поданных заявках: где моя справка, когда будет готово, какой статус',
  other: 'Посторонняя тема, не связанная с учёбой и услугами вуза',
};

/** Понять сообщение студента: намерение + (если это просьба) услуга и поля. Один запрос к Jev. */
export async function understandWithJev(services: Service[], text: string): Promise<Understanding> {
  const { intent, route } = await askAll(services, text);
  return { intent, route, engine: 'jev' };
}

/** Только маршрутизация (для совместимости). */
export async function routeWithJev(services: Service[], text: string): Promise<RouteResult | null> {
  return (await askAll(services, text)).route;
}

async function askAll(services: Service[], text: string): Promise<{ intent: Intent; route: RouteResult | null }> {

  // 1. Какая услуга. Ключи вариантов — s0, s1… (id услуг из конструктора могут быть любыми).
  const svcCriteria: Record<string, string> = {};
  services.forEach((s, i) => {
    // Варианты полей-списков помогают Jev: «справка в военкомат» — это всё ещё справка об обучении
    const opts = s.fields
      .filter((f) => f.type === 'select' && f.options?.length)
      .map((f) => `${f.label}: ${f.options!.join(', ')}`)
      .join('; ');
    const variants = opts ? ` Варианты — ${opts}.` : '';
    const hints = s.aiHints?.length ? ` Типичные запросы: ${s.aiHints.join(', ')}.` : '';
    svcCriteria[`s${i}`] = `${s.title}. ${s.description}.${variants}${hints}`;
  });
  svcCriteria.other = 'Сообщение не относится ни к одной из услуг выше (приветствие, погода, посторонний вопрос)';

  const questions: Record<string, ChoiceQuestion> = {
    intent: {
      type: 'choice',
      instructions: 'Что хочет студент, написавший сообщение `message` чат-боту вуза?',
      criteria: INTENTS,
    },
    service: {
      type: 'choice',
      instructions: 'Какую услугу вуза просит оформить студент в сообщении `message`?',
      criteria: svcCriteria,
    },
  };

  // 2. Поля-списки всех услуг — сразу в том же запросе (зависимые вопросы у Jev — отдельные вызовы, так быстрее).
  services.forEach((s, i) => {
    for (const f of s.fields) {
      if (f.type !== 'select' || !f.options?.length) continue;
      const criteria: Record<string, string> = {};
      f.options.forEach((o, j) => (criteria[`o${j}`] = o));
      criteria.none = 'В сообщении об этом ничего не сказано';
      questions[fieldKey(i, f.id)] = {
        type: 'choice',
        instructions: `Если студенту нужна услуга «${s.title}»: что он указал для поля «${f.label}»?`,
        criteria,
      };
    }
  });

  const state = JSON.stringify({ message: text });
  const { answers, usage } = await askJev(state, questions);
  lastJevUsage = usage as typeof lastJevUsage;

  // Разговор (привет, спасибо, что умеешь, где моя заявка) — услугу не ищем
  const ia = answers.intent;
  const intent = (ia?.choice ?? 'request') as Intent;
  if (intent !== 'request' && intent !== 'other' && (ia?.probabilities?.[intent] ?? 0) >= 0.5) return { intent, route: null };

  const route = pickService(services, text, answers);
  return { intent: route ? 'request' : 'other', route };
}

function pickService(services: Service[], text: string, answers: Record<string, ChoiceAnswer>): RouteResult | null {
  const svcAns = answers.service;
  if (!svcAns) return null;

  const probs = Object.entries(svcAns.probabilities ?? {})
    .filter(([k]) => k !== 'other')
    .sort((a, b) => b[1] - a[1]);
  const pOther = svcAns.probabilities?.other ?? 0;
  const top = probs[0];
  if (!top || (svcAns.choice === 'other' && pOther >= SURE)) return null;

  const idx = Number(top[0].slice(1));
  const service = services[idx];
  if (!service) return null;

  // Значения полей, в которых Jev уверен
  const prefill: Record<string, string> = {};
  for (const f of service.fields) {
    const a = answers[fieldKey(idx, f.id)];
    if (!a || a.choice === 'none' || !f.options) continue;
    const p = a.probabilities?.[a.choice] ?? a.confidence;
    const opt = f.options[Number(a.choice.slice(1))];
    if (opt && p >= SURE) prefill[f.id] = opt;
  }
  // Текстовые поля Jev не заполняет (он не генерирует текст) — берём простые эвристики
  for (const [k, v] of Object.entries(prefillFor(service, text.toLowerCase()))) {
    const f = service.fields.find((x) => x.id === k);
    if (f && f.type !== 'select' && !prefill[k]) prefill[k] = v;
  }

  const sure = svcAns.choice !== 'other' && top[1] >= SURE;
  const alternatives = sure
    ? undefined
    : probs
        .filter(([, p]) => p >= MAYBE)
        .slice(0, 3)
        .map(([k]) => services[Number(k.slice(1))])
        .filter(Boolean);

  return {
    service,
    prefill,
    confidence: top[1],
    alternatives: alternatives?.length ? alternatives : undefined,
    engine: 'jev',
  };
}
