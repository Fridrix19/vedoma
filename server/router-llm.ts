import type { Service } from '../src/shared/types';
import { intentByKeywords, routeByKeywords, type RouteResult, type Understanding } from '../src/shared/router';
import { config } from './config';
import { jevEnabled, understandWithJev } from './router-jev';

// Маршрутизатор бота. Если задан JEV_API_KEY — спрашиваем Jev (server/router-jev.ts). Если в .env заданы LLM_API_URL / LLM_API_KEY / LLM_MODEL —
// спрашиваем нейросеть (любой OpenAI-совместимый /chat/completions), иначе ищем по ключевым фразам.
// Сюда ИИ-мастер подключает свой провайдер: достаточно поменять тело запроса.

/** Понять сообщение студента: разговор или просьба об услуге. Приоритет: Jev → LLM → ключевые фразы. */
export async function understandMessage(services: Service[], text: string): Promise<Understanding> {
  const active = services.filter((s) => s.enabled && s.published);
  if (jevEnabled()) {
    try {
      return await understandWithJev(active, text);
    } catch (e) {
      console.warn('[router] Jev недоступен, использую запасной вариант:', (e as Error).message);
    }
  }
  const intent = intentByKeywords(text);
  if (intent) return { intent, route: null, engine: 'keywords' };
  const route = await routeMessage(active, text);
  return { intent: route ? 'request' : 'other', route, engine: route?.engine ?? 'keywords' };
}

export async function routeMessage(services: Service[], text: string): Promise<RouteResult | null> {
  const active = services.filter((s) => s.enabled && s.published);
  if (!config.llm.url || !config.llm.key || !config.llm.model) return routeByKeywords(active, text);
  try {
    return (await routeWithLlm(active, text)) ?? routeByKeywords(active, text);
  } catch (e) {
    console.warn('[router] LLM недоступна, использую ключевые слова:', (e as Error).message);
    return routeByKeywords(active, text);
  }
}

async function routeWithLlm(services: Service[], text: string): Promise<RouteResult | null> {
  const catalog = services.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    hints: s.aiHints ?? [],
    fields: s.fields.filter((f) => f.type !== 'file').map((f) => ({ id: f.id, label: f.label, options: f.options })),
  }));
  const system =
    'Ты маршрутизатор студенческих заявок вуза. По сообщению студента выбери одну услугу из каталога ' +
    'и заполни поля, если значения явно следуют из текста (для полей с options — только значение из options). ' +
    'Ответь строго JSON: {"serviceId": string|null, "confidence": number от 0 до 1, "prefill": {fieldId: value}}. ' +
    'Если запрос не про услуги каталога — serviceId null.';
  const res = await fetch(config.llm.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.key}` },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Каталог: ${JSON.stringify(catalog)}\n\nСообщение студента: ${text}` },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  const json = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)) as {
    serviceId: string | null;
    confidence?: number;
    prefill?: Record<string, string>;
  };
  const svc = services.find((s) => s.id === json.serviceId);
  if (!svc || (json.confidence ?? 1) < 0.4) return null;
  const prefill: Record<string, string> = {};
  for (const [k, v] of Object.entries(json.prefill ?? {})) {
    const f = svc.fields.find((x) => x.id === k);
    if (!f || typeof v !== 'string') continue;
    if (f.type === 'select' && !f.options?.includes(v)) continue;
    prefill[k] = v;
  }
  return { service: svc, prefill, confidence: json.confidence ?? 1, engine: 'llm' };
}

/** Какой маршрутизатор сейчас активен — для /api/health. */
export const routerEngine = (): 'jev' | 'llm' | 'keywords' =>
  jevEnabled() ? 'jev' : config.llm.url && config.llm.key && config.llm.model ? 'llm' : 'keywords';
