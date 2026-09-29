// Проверка ИИ-маршрутизатора Jev без бота и MAX: npm run jev:check [-- "свой текст"]
// Берёт ключ и адрес из .env (JEV_API_KEY, JEV_API_URL, JEV_MODEL) и услуги тестового вуза.
import { createSeed } from '../src/shared/seed';
import { config } from './config';
import { jevEnabled, lastJevUsage, understandWithJev } from './router-jev';

const phrases = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Привет', 'Что ты умеешь?', 'Нужна справка', 'Нужна справка для банка', 'Хочу взять академ по здоровью', 'Где моя справка?', 'Спасибо', 'Какая погода завтра'];

if (!jevEnabled()) {
  console.error('В .env не задан JEV_API_KEY');
  process.exit(1);
}
console.log(`Jev: ${config.jev.url}  модель ${config.jev.model}\n`);
const services = createSeed().services.filter((s) => s.tenantId === 'univ-a' && s.enabled && s.published);
let total = 0;
for (const text of phrases) {
  const t0 = Date.now();
  try {
    const u = await understandWithJev(services, text);
    const r = u.route;
    const ms = Date.now() - t0;
    const cost = lastJevUsage?.cost_rub;
    if (cost) total += cost;
    console.log(`«${text}»  (${ms} мс${cost ? `, ${cost.toFixed(4)} ₽` : ''})`);
    const talk: Record<string, string> = {
      greeting: 'приветствие: бот представится и перечислит услуги',
      help: 'вопрос «что умеешь»: бот расскажет, как работает',
      thanks: 'благодарность: бот ответит «Пожалуйста»',
      status: 'вопрос о статусе: бот покажет «Мои заявки»',
      other: 'не про услуги: бот скажет, с чем может помочь',
    };
    if (!r) console.log(`  → ${talk[u.intent] ?? u.intent}`);
    else if (r.alternatives) console.log(`  → неоднозначно, бот спросит: ${r.alternatives.map((s) => s.title).join(' / ')}`);
    else {
      console.log(`  → ${r.service.title} (уверенность ${r.confidence.toFixed(2)})`);
      const missing = r.service.fields.filter((f) => f.required && f.type === 'select' && !r.prefill[f.id]);
      console.log(`    заполнено: ${JSON.stringify(r.prefill)}`);
      if (missing.length) console.log(`    бот уточнит кнопками: ${missing.map((f) => f.label).join(', ')}`);
    }
  } catch (e) {
    console.log(`«${text}»  ОШИБКА: ${(e as Error).message}`);
  }
}
if (total) console.log(`\nИтого: ${total.toFixed(4)} ₽`);
