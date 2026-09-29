import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './demo.css';
import MiniApp from '../miniapp/MiniApp';
import Panel from '../panel/Panel';
import { emitBus, resetDB, useDB, usePersistent } from '../shared/store';
import { createDraftLocal as createDraft, rateRequest, routeMessageLocal as routeMessage } from '../shared/api';
import { hhmm, pluralDays } from '../shared/dates';
import type { BotMessage, PanelRole } from '../shared/types';

// Демо-стенд для защиты: слева чат с ботом (симуляция MAX), в центре телефон с Mini App,
// справа веб-панель вуза. Все три части работают с одними данными.

const PHONE_W = 390;
const PHONE_H = 844;

export default function Demo() {
  const db = useDB();
  const [studentSession] = usePersistent<{ studentId: string } | null>('uniflow.student', null);
  const [panelSession] = usePersistent<{ role: PanelRole; tenantId: string }>('uniflow.panel', { role: 'staff', tenantId: 'univ-a' });
  const [confirmReset, setConfirmReset] = useState(false);

  const demoReq = db.requests.filter((r) => r.id >= 18425).sort((a, b) => a.id - b.id)[0];
  const steps = [
    { label: 'Запрос', done: db.drafts.length > 0 || Boolean(demoReq), hint: 'Напишите боту «Мне нужна справка для банка» и нажмите «Оформить»' },
    { label: 'Заявка', done: Boolean(demoReq), hint: 'Проверьте форму в Mini App и нажмите «Отправить»' },
    { label: 'Входящие', done: Boolean(demoReq && demoReq.status !== 'accepted'), hint: 'В панели нажмите «Взять в работу»' },
    { label: 'Готово', done: demoReq?.status === 'done', hint: 'Сформируйте справку и отметьте «Готово»' },
    {
      label: 'Уведомление',
      done: Boolean(demoReq && db.messages.some((m) => m.requestId === demoReq.id && m.text.includes('готова'))),
      hint: 'Студенту приходит PDF в чат и в Mini App',
    },
    { label: 'Второй вуз', done: panelSession.tenantId !== 'univ-a', hint: 'В панели переключите вуз на «Университет Б»' },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="demo">
      <header className="demo-top">
        <div className="demo-brand">
          <span className="demo-brand__mark">U</span>
          <div>
            <div className="demo-brand__name">Ведома</div>
            <div className="demo-brand__sub">Демо-стенд · бот MAX + Mini App + панель вуза · тестовые данные</div>
          </div>
        </div>
        <ol className="demo-steps" aria-label="Сценарий демонстрации">
          {steps.map((s, i) => (
            <li key={s.label} className={s.done ? 'is-done' : i === current ? 'is-current' : ''} title={s.hint}>
              <span className="demo-steps__n">{s.done ? '✓' : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
        <div className="demo-reset">
          {confirmReset ? (
            <>
              <span>Вернуть исходные данные?</span>
              <button className="btn btn--danger" onClick={() => {
                resetDB();
                try {
                  localStorage.removeItem('uniflow.student');
                  localStorage.removeItem('uniflow.panel');
                } catch { /* ignore */ }
                window.location.reload();
              }}>Сбросить</button>
              <button className="btn" onClick={() => setConfirmReset(false)}>Отмена</button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirmReset(true)}>Сбросить демо</button>
          )}
        </div>
      </header>
      {current >= 0 && <div className="demo-hint"><b>Шаг {current + 1}.</b> {steps[current].hint}</div>}

      <main className="demo-stage">
        <section className="demo-col demo-col--chat" aria-label="Чат с ботом в MAX">
          <div className="demo-label">MAX · чат с ботом <em>симуляция</em></div>
          <BotChat studentId={studentSession?.studentId ?? null} />
        </section>
        <section className="demo-col demo-col--phone" aria-label="Mini App">
          <div className="demo-label">Mini App · 390 × 844</div>
          <Phone>
            <MiniApp framed />
          </Phone>
        </section>
        <section className="demo-col demo-col--panel" aria-label="Веб-панель вуза">
          <div className="demo-label">Веб-панель вуза · {panelSession.role === 'staff' ? 'сотрудник деканата' : 'администратор'}</div>
          <div className="demo-desktop">
            <Panel framed />
          </div>
        </section>
      </main>
    </div>
  );
}

/** Рамка телефона, масштабируется под высоту экрана. */
function Phone({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const fit = () => {
      const availH = el.clientHeight - 28;
      const availW = el.clientWidth;
      const byH = availH > 400 ? availH / PHONE_H : 1;
      setScale(Math.max(0.6, Math.min(1, byH, availW / PHONE_W)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="demo-phone-box" style={{ width: PHONE_W * scale, height: PHONE_H * scale }}>
      <div className="demo-phone" style={{ transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

// ——— Симуляция чата MAX ———
// Реальный бот живёт в MAX; здесь — ровно те сообщения и кнопки, что он отправит.

type ChatItem =
  | { kind: 'user'; id: string; at: string; text: string }
  | { kind: 'bot'; id: string; at: string; text: string; buttons: { label: string; onClick?: () => void }[]; inline?: boolean };

function BotChat({ studentId }: { studentId: string | null }) {
  const db = useDB();
  const student = studentId ? db.students.find((s) => s.id === studentId) : undefined;
  const [local, setLocal] = useState<ChatItem[]>([]);
  const [text, setText] = useState('Мне нужна справка для банка');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLocal([]), [studentId]);

  const notifications: ChatItem[] = useMemo(
    () =>
      (student ? db.messages.filter((m) => m.audience === 'student' && m.studentId === student.id) : []).map((m: BotMessage) => ({
        kind: 'bot' as const,
        id: m.id,
        at: m.at,
        text: m.text,
        buttons: m.buttons.map((b) => ({
          label: b.action === 'rate' ? `${b.label} ★` : b.label,
          onClick: () =>
            b.action === 'rate'
              ? rateRequest(m.requestId, m.studentId!, Number(b.value), undefined).catch(() => undefined)
              : emitBus({ type: 'miniapp:open-request', requestId: m.requestId }),
        })),
        inline: m.buttons.some((b) => b.action === 'rate'),
      })),
    [db.messages, student],
  );

  const items = [...local, ...notifications].sort((a, b) => a.at.localeCompare(b.at));

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [items.length]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || !student) return;
    const at = new Date().toISOString();
    const user: ChatItem = { kind: 'user', id: `u${at}`, at, text: msg };
    const routed = routeMessage(student.tenantId, msg);
    let reply: ChatItem;
    if (routed) {
      const svc = routed.service;
      reply = {
        kind: 'bot', id: `b${at}`, at: new Date(Date.now() + 1).toISOString(),
        text: `${/^справк/i.test(svc.title) ? `Похоже, вам нужна ${svc.title.toLowerCase()}.` : `Похоже, вам подходит услуга «${svc.title}».`}\nОбычно готовится до ${svc.slaDays} ${pluralDays(svc.slaDays)}.`,
        buttons: [
          {
            label: 'Оформить',
            onClick: () => {
              const draft = createDraft(student.id, svc.id, routed.prefill, msg);
              emitBus({ type: 'miniapp:open-draft', draftId: draft.id });
            },
          },
          {
            label: 'Это другая услуга',
            onClick: () =>
              setLocal((p) => [...p, {
                kind: 'bot', id: `o${Date.now()}`, at: new Date().toISOString(),
                text: 'Уточните, что нужно, или выберите услугу в каталоге Mini App.', buttons: [],
              }]),
          },
        ],
      };
    } else {
      reply = {
        kind: 'bot', id: `b${at}`, at: new Date(Date.now() + 1).toISOString(),
        text: 'Не понял запрос. Опишите иначе или откройте каталог услуг в Mini App.', buttons: [],
      };
    }
    setLocal((p) => [...p, user, reply]);
    setText('');
  };

  return (
    <div className="chat">
      <div className="chat__head">
        <span className="chat__avatar">Б</span>
        <div>
          <b>Бот</b>
          <span>бот-помощник для студента</span>
        </div>
      </div>
      <div className="chat__list" ref={listRef}>
        <div className="chat__msg chat__msg--bot">
          <div className="chat__bubble">
            {student
              ? `Здравствуйте, ${student.firstName}! Напишите, что нужно, — например, «справка для банка». Или откройте каталог.`
              : 'Здравствуйте! Я Бот — помогу оформить услуги. Войдите через вуз в Mini App, чтобы ФИО и группа подставлялись сами.'}
          </div>
        </div>
        {items.map((it) =>
          it.kind === 'user' ? (
            <div key={it.id} className="chat__msg chat__msg--user">
              <div className="chat__bubble">{it.text}<span className="chat__time">{hhmm(it.at)} ✓</span></div>
            </div>
          ) : (
            <div key={it.id} className="chat__msg chat__msg--bot">
              <div className="chat__bubble">{it.text}<span className="chat__time">{hhmm(it.at)}</span></div>
              {it.buttons.length > 0 && (
                <div className={`chat__buttons ${it.inline ? 'chat__buttons--row' : ''}`}>
                  {it.buttons.map((b) => (
                    <button key={b.label} onClick={b.onClick}>{b.label}</button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
      </div>
      <form className="chat__input" onSubmit={send}>
        <input id="chat-text" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={student ? 'Сообщение' : 'Сначала войдите в Mini App'} disabled={!student} aria-label="Сообщение боту" />
        <button className="btn btn--primary" type="submit" disabled={!student || !text.trim()}>Отправить</button>
      </form>
      {student && (
        <div className="chat__examples">
          {['Мне нужна справка для банка', 'Хочу взять академ', 'Нужна матпомощь', 'Записаться в деканат'].map((ex) => (
            <button key={ex} onClick={() => setText(ex)}>{ex}</button>
          ))}
        </div>
      )}
      <p className="chat__note">
        Кнопки бота открывают Mini App через start_param. Статусы из панели приходят сюда как пуши.
      </p>
    </div>
  );
}
