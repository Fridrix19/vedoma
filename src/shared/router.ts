import type { Service } from './types';

// ИИ-маршрутизатор: свободный текст студента → услуга + предзаполненные поля.
// Базовая версия — по ключевым фразам (aiHints из конструктора услуг), работает без ключей.
// На сервере поверх неё можно включить LLM (см. server/router-llm.ts).

export interface RouteResult {
  service: Service;
  prefill: Record<string, string>;
  confidence: number; // 0..1
  /** Другие подходящие услуги, если запрос неоднозначный (бот предложит выбрать кнопками). */
  alternatives?: Service[];
  /** Кто распознал запрос. */
  engine?: 'jev' | 'llm' | 'keywords';
}

/** Что хочет студент от бота. request — оформить услугу, остальное — разговор. */
export type Intent = 'request' | 'greeting' | 'thanks' | 'help' | 'status' | 'other';

export interface Understanding {
  intent: Intent;
  /** Услуга и поля — только для intent === 'request'. */
  route: RouteResult | null;
  engine: 'jev' | 'llm' | 'keywords';
}

/** Разговорные намерения по простым фразам (когда ИИ не подключён). */
export function intentByKeywords(text: string): Intent | null {
  const t = text.toLowerCase().replace(/ё/g, 'е').trim();
  if (/^(привет|здравствуй(те)?|добрый (день|вечер)|доброе утро|хай|салют)[\s!.,)]*$/.test(t)) return 'greeting';
  if (/^(спасибо|благодарю|спс|пока|до свидания)/.test(t)) return 'thanks';
  if (/(что (ты )?умеешь|ты кто|кто ты|чем (ты )?(можешь )?помочь|^помоги[\s!.]*$|^помощь[\s!.]*$)/.test(t)) return 'help';
  if (/(где мо[яий]|статус|когда будет готов|мои заявки)/.test(t)) return 'status';
  return null;
}

export function routeByKeywords(services: Service[], text: string): RouteResult | null {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  const scored: { svc: Service; score: number }[] = [];
  for (const svc of services) {
    if (!svc.enabled || !svc.published) continue;
    const hints = [...(svc.aiHints ?? []), svc.title];
    const score = hints.reduce((acc, h) => {
      const hh = h.toLowerCase().replace(/ё/g, 'е');
      return acc + (hh && t.includes(hh) ? hh.length : 0);
    }, 0);
    if (score > 0) scored.push({ svc, score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Неоднозначно: второй кандидат почти так же хорош
  const close = scored.filter((x) => x.score * 2 > best.score);
  return {
    service: best.svc,
    prefill: prefillFor(best.svc, t),
    confidence: close.length > 1 ? 0.4 : Math.min(1, best.score / 12),
    alternatives: close.length > 1 ? close.slice(0, 3).map((x) => x.svc) : undefined,
    engine: 'keywords',
  };
}

/** Эвристики предзаполнения по тексту (LLM делает то же самое точнее). */
export function prefillFor(svc: Service, text: string): Record<string, string> {
  const t = text.toLowerCase();
  const prefill: Record<string, string> = {};
  const place = svc.fields.find((f) => f.id === 'place');
  if (place) {
    const pick = (label: string) => place.options?.find((o) => o === label);
    const v =
      /банк|кредит|ипотек/.test(t) ? pick('Банк / кредит')
        : /военкомат|отсрочк/.test(t) ? pick('Военкомат')
          : /мфц|соцзащит|пособи/.test(t) ? pick('Соцзащита / МФЦ')
            : /виз|посольств/.test(t) ? pick('Посольство / виза')
              : /родител|работ/.test(t) ? pick('Работа родителей')
                : undefined;
    if (v) prefill.place = v;
    if (/кредит/.test(t)) prefill.reason = 'Для оформления кредита';
  }
  return prefill;
}
