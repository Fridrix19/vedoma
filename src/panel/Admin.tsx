import { useState } from 'react';
import type { CategoryId, DB, FieldType, ResultType, Service, ServiceField } from '../shared/types';
import { CATEGORIES } from '../shared/types';
import { saveService, serviceInsights, setServiceEnabled, tenantRating, tenantStats } from '../shared/api';
import type { ServiceInsight } from '../shared/domain';
import { pluralDays } from '../shared/dates';
import { IconClose, IconGrip, IconPlus, SERVICE_ICONS, ServiceIcon } from '../shared/icons';

// ——— 4.1 Дашборд вуза ———

export function Dashboard({ db, tenantId, stats, onNew, onEdit }: {
  db: DB; tenantId: string; stats: ReturnType<typeof tenantStats>;
  onNew: () => void; onEdit: (id: string) => void;
}) {
  const services = db.services.filter((s) => s.tenantId === tenantId);
  const countFor = (id: string) => db.requests.filter((r) => r.serviceId === id).length;
  const insights = serviceInsights(db, tenantId).filter((i) => i.total > 0);
  const rating = tenantRating(db, tenantId);
  const titleOf = (id: string) => db.services.find((s) => s.id === id)?.title ?? id;
  const tips = recommendations(insights, titleOf);
  const fmt1 = (n: number) => n.toFixed(1).replace('.', ',');

  return (
    <>
      <header className="pn-head">
        <div>
          <h1>Дашборд вуза</h1>
          <p>Статистика и включение услуг в каталог</p>
        </div>
        <button className="btn btn--primary" onClick={onNew}>Новая услуга</button>
      </header>
      <div className="pn-body">
        <div className="pn-stats">
          <div className="pn-stat">
            <span>Заявок обработано</span>
            <b className="tnum">{stats.processed}</b>
          </div>
          <div className="pn-stat">
            <span>Сейчас в работе</span>
            <b className="tnum">{stats.inWork}</b>
            <small>{stats.newCount} новых · {stats.overdue} просрочено</small>
          </div>
          <div className="pn-stat">
            <span>Средний срок</span>
            <b className="tnum">{fmt1(stats.avgDays)} дн.</b>
          </div>
          <div className="pn-stat">
            <span>Оценка студентов</span>
            <b className="tnum">{rating.avg != null ? `${fmt1(rating.avg)} ★` : '—'}</b>
            <small>{rating.count ? `${rating.count} оценок после «Готово»` : 'Оценок пока нет'}</small>
          </div>
        </div>

        {insights.length > 0 && (
          <section className="pn-insights" aria-labelledby="insights-title">
            <div className="pn-insights__head">
              <h2 id="insights-title">Обратная связь и узкие места</h2>
              <span>Расчёт по заявкам в системе · тестовые данные</span>
            </div>
            <div className="pn-table-wrap">
              <table className="pn-table pn-table--compact">
                <thead>
                  <tr>
                    <th>Услуга</th>
                    <th>Заявок</th>
                    <th>Ср. срок</th>
                    <th>Просрочено</th>
                    <th>С уточнением</th>
                    <th>Оценка</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.map((i) => (
                    <tr key={i.serviceId} onClick={() => onEdit(i.serviceId)} title="Открыть в конструкторе">
                      <td>{titleOf(i.serviceId)}</td>
                      <td className="tnum">{i.total}</td>
                      <td className="tnum">{i.avgDays != null ? `${fmt1(i.avgDays)} дн.` : '—'}</td>
                      <td className={`tnum ${i.overdue ? 'is-late' : ''}`}>{i.overdue}</td>
                      <td className={`tnum ${i.needInfoShare >= 0.3 ? 'is-warn' : ''}`}>{Math.round(i.needInfoShare * 100)}%</td>
                      <td className={`tnum ${i.ratingAvg != null && i.ratingAvg < 3.5 ? 'is-late' : ''}`}>
                        {i.ratingAvg != null ? `${fmt1(i.ratingAvg)} ★ (${i.ratingCount})` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pn-insights__grid">
              <div className="pn-insights__card">
                <h3>Что пишут студенты</h3>
                {rating.lowComments.length === 0 ? (
                  <p className="pn-aside__empty">Низких оценок с комментариями нет.</p>
                ) : (
                  <ul className="pn-feedback">
                    {rating.lowComments.map((r) => (
                      <li key={r.id}>
                        <span className="pn-feedback__score">{r.rating!.score}/5</span>
                        <div>
                          <div>«{r.rating!.comment}»</div>
                          <small>№{r.id} · {titleOf(r.serviceId)}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="pn-insights__card">
                <h3>Что улучшить</h3>
                {tips.length === 0 ? (
                  <p className="pn-aside__empty">Явных узких мест нет.</p>
                ) : (
                  <ul className="pn-tips">{tips.map((t) => <li key={t}>{t}</li>)}</ul>
                )}
                <small className="pn-insights__note">Рекомендации рассчитаны по правилам, это не решение за сотрудников.</small>
              </div>
            </div>
          </section>
        )}

        <div className="pn-services">
          {services.map((s) => {
            const n = countFor(s.id);
            const sub = !s.published
              ? 'Черновик · не опубликована'
              : s.enabled
                ? 'В Mini App и боте'
                : 'Выключена · студент не видит, пока не включить';
            return (
              <div key={s.id} className={`pn-service ${s.enabled ? '' : 'is-off'}`}>
                <span className="pn-service__icon"><ServiceIcon name={s.icon} /></span>
                <button className="pn-service__main" onClick={() => onEdit(s.id)} title="Открыть в конструкторе">
                  <b>{s.title}</b>
                  <span>{sub}{n ? ` · заявок: ${n}` : ''}</span>
                </button>
                <label className="pn-toggle" title={s.enabled ? 'Выключить' : 'Включить'}>
                  <input type="checkbox" checked={s.enabled} onChange={(e) => { setServiceEnabled(s.id, e.target.checked).catch(() => undefined); }}
                    aria-label={`${s.title}: показывать студентам`} />
                  <span />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** Правила-подсказки по узким местам (прозрачный расчёт, без ИИ). */
function recommendations(list: ServiceInsight[], titleOf: (id: string) => string): string[] {
  const out: string[] = [];
  for (const i of list) {
    const t = titleOf(i.serviceId);
    if (i.total >= 2 && i.needInfoShare >= 0.3) {
      out.push(`«${t}»: ${Math.round(i.needInfoShare * 100)}% заявок уходят на уточнение — добавьте подсказку или обязательное поле в форму.`);
    }
    if (i.overdue > 0) out.push(`«${t}»: просрочено ${i.overdue} — проверьте срок в маршруте или нагрузку отдела.`);
    if (i.ratingAvg != null && i.ratingAvg < 3.5 && i.ratingCount >= 2) {
      out.push(`«${t}»: средняя оценка ${i.ratingAvg.toFixed(1).replace('.', ',')} — прочитайте комментарии студентов.`);
    }
  }
  return out.slice(0, 4);
}

// ——— 4.2 Конструктор услуг ———

const PALETTE: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Текст' },
  { type: 'date', label: 'Дата' },
  { type: 'file', label: 'Файл' },
  { type: 'select', label: 'Список' },
  { type: 'textarea', label: 'Абзац' },
  { type: 'time', label: 'Время' },
];
const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Текст', textarea: 'Абзац', date: 'Дата', time: 'Время', select: 'Список', file: 'Файл',
};

const RESULT_OPTIONS: { id: ResultType; label: string }[] = [
  { id: 'pdf', label: 'PDF-документ в чат' },
  { id: 'visit', label: 'Выдача лично / запись' },
  { id: 'none', label: 'Решение без документа' },
];

const uid = () => Math.random().toString(36).slice(2, 8);

function blankService(tenantId: string): Service {
  return {
    id: `svc-${uid()}`, tenantId, title: 'Новая услуга', description: '', icon: 'doc', category: 'docs',
    meta: '', slaDays: 3, resultType: 'none', resultNote: 'результат придёт в чат', department: 'Деканат',
    fields: [{ id: uid(), type: 'text', label: 'Комментарий', required: false }],
    enabled: false, published: false, aiHints: [],
  };
}

function buildMeta(s: Service) {
  const cat = CATEGORIES.find((c) => c.id === s.category)?.label ?? '';
  const res = s.resultType === 'pdf' ? ' · PDF' : '';
  return `${cat}${res} · до ${s.slaDays} раб. ${s.slaDays === 1 ? 'дня' : 'дней'}`;
}

export function Builder({ db, tenantId, serviceId, onDone }: {
  db: DB; tenantId: string; serviceId: string | null; onDone: (msg: string) => void;
}) {
  const existing = serviceId ? db.services.find((s) => s.id === serviceId) : undefined;
  const [svc, setSvc] = useState<Service>(() => structuredClone(existing ?? blankService(tenantId)));
  const [dragOver, setDragOver] = useState<number | 'end' | null>(null);
  const [error, setError] = useState('');

  const patch = (p: Partial<Service>) => setSvc((s) => ({ ...s, ...p }));
  const setField = (i: number, p: Partial<ServiceField>) =>
    setSvc((s) => ({ ...s, fields: s.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  const addField = (type: FieldType, at?: number) => {
    const f: ServiceField = {
      id: uid(), type, label: TYPE_LABEL[type], required: false,
      ...(type === 'select' ? { options: ['Вариант 1', 'Вариант 2'] } : {}),
    };
    setSvc((s) => {
      const fields = [...s.fields];
      fields.splice(at ?? fields.length, 0, f);
      return { ...s, fields };
    });
  };
  const moveField = (from: number, to: number) =>
    setSvc((s) => {
      const fields = [...s.fields];
      const [f] = fields.splice(from, 1);
      fields.splice(to > from ? to - 1 : to, 0, f);
      return { ...s, fields };
    });

  const onDrop = (e: React.DragEvent, at: number | undefined) => {
    e.preventDefault();
    setDragOver(null);
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('new:')) addField(data.slice(4) as FieldType, at);
    if (data.startsWith('move:')) moveField(Number(data.slice(5)), at ?? svc.fields.length);
  };

  const save = (publish: boolean) => {
    if (!svc.title.trim()) return setError('Укажите название услуги.');
    if (svc.fields.some((f) => !f.label.trim())) return setError('У каждого поля должно быть название.');
    if (svc.fields.some((f) => f.type === 'select' && !(f.options?.filter(Boolean).length))) return setError('Добавьте варианты в поле-список.');
    const final: Service = { ...svc, title: svc.title.trim(), meta: buildMeta(svc) };
    setError('');
    saveService(final, publish)
      .then(() => onDone(publish ? `«${final.title}» опубликована и появилась в Mini App и боте.` : `Черновик «${final.title}» сохранён.`))
      .catch((e) => setError((e as Error).message));
  };

  return (
    <>
      <header className="pn-head">
        <div>
          <h1>Конструктор услуг</h1>
          <p>{svc.title || 'Новая услуга'}{existing?.published ? (existing.enabled ? ' · опубликована' : ' · выключена') : ' · черновик'}</p>
        </div>
      </header>
      <div className="pn-body pn-builder">
        {/* 1 · База */}
        <section className="pn-col pn-col--base">
          <h2>1 · База</h2>
          <label className="pn-input">
            <span>Название</span>
            <input id="b-title" value={svc.title} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <label className="pn-input">
            <span>Описание</span>
            <textarea id="b-desc" rows={2} value={svc.description} onChange={(e) => patch({ description: e.target.value })}
              placeholder="Коротко: что получит студент" />
          </label>
          <label className="pn-input">
            <span>Категория в каталоге</span>
            <select id="b-cat" value={svc.category} onChange={(e) => patch({ category: e.target.value as CategoryId })}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <div className="pn-input">
            <span>Иконка</span>
            <div className="pn-icons" role="radiogroup" aria-label="Иконка">
              {Object.entries(SERVICE_ICONS).map(([k, v]) => (
                <button key={k} role="radio" aria-checked={svc.icon === k} className={svc.icon === k ? 'is-active' : ''}
                  onClick={() => patch({ icon: k })} title={v.label}>
                  <ServiceIcon name={k} />
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 2 · Форма */}
        <section className="pn-col pn-col--form">
          <h2>2 · Форма</h2>
          <div className="pn-form-builder">
            <div className="pn-palette">
              {PALETTE.map((p) => (
                <button key={p.type} draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', `new:${p.type}`)}
                  onClick={() => addField(p.type)} title="Перетащите в форму или нажмите">
                  <IconPlus size={14} /> {p.label}
                </button>
              ))}
            </div>
            <div className={`pn-drop ${dragOver === 'end' ? 'is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver('end'); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, undefined)}>
              <div className="pn-drop__locked">ФИО и группа — из вуза</div>
              {svc.fields.map((f, i) => (
                <div key={f.id} className={`pn-fitem ${dragOver === i ? 'is-over' : ''}`} draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', `move:${i}`)}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(i); }}
                  onDrop={(e) => { e.stopPropagation(); onDrop(e, i); }}>
                  <span className="pn-fitem__grip"><IconGrip /></span>
                  <div className="pn-fitem__body">
                    <div className="pn-fitem__type">{TYPE_LABEL[f.type]}</div>
                    <input aria-label="Название поля" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
                    {f.type === 'select' && (
                      <input className="pn-fitem__opts" aria-label="Варианты через запятую"
                        value={(f.options ?? []).join(', ')}
                        onChange={(e) => setField(i, { options: e.target.value.split(',').map((x) => x.trim()) })}
                        placeholder="Варианты через запятую" />
                    )}
                    <label className="pn-fitem__req">
                      <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} />
                      Обязательное
                    </label>
                  </div>
                  <button className="icon-btn" onClick={() => setSvc((s) => ({ ...s, fields: s.fields.filter((_, j) => j !== i) }))}
                    aria-label={`Удалить поле ${f.label}`}>
                    <IconClose />
                  </button>
                </div>
              ))}
              {svc.fields.length === 0 && <div className="pn-drop__hint">Перетащите сюда поля слева</div>}
            </div>
          </div>
        </section>

        {/* 3 · Маршрут */}
        <section className="pn-col pn-col--route">
          <h2>3 · Маршрут</h2>
          <label className="pn-input">
            <span>Отдел</span>
            <input id="b-dept" value={svc.department} onChange={(e) => patch({ department: e.target.value })} />
          </label>
          <label className="pn-input">
            <span>Дней на выполнение</span>
            <input id="b-sla" type="number" min={1} max={30} value={svc.slaDays}
              onChange={(e) => patch({ slaDays: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
          </label>
          <label className="pn-input">
            <span>Результат для студента</span>
            <select id="b-result" value={svc.resultType}
              onChange={(e) => {
                const rt = e.target.value as ResultType;
                patch({
                  resultType: rt,
                  resultNote: rt === 'pdf' ? 'результат: PDF в чат и в заявку' : rt === 'visit' ? 'где и когда забрать — придёт в чат' : 'решение придёт в чат и в заявку',
                });
              }}>
              {RESULT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          <label className="pn-input">
            <span>Как студенты об этом пишут боту</span>
            <input id="b-hints" value={(svc.aiHints ?? []).join(', ')}
              onChange={(e) => patch({ aiHints: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
              placeholder="пропуск, турникет, не пускают в корпус" />
            <small>Фразы-подсказки для ИИ-маршрутизатора бота</small>
          </label>

          <div className="pn-preview">
            <div className="pn-preview__label">Так увидит студент</div>
            <div className="pn-preview__card">
              <b>{svc.title || 'Новая услуга'}</b>
              <span>{buildMeta(svc)}</span>
            </div>
            <div className="pn-preview__sla">До {svc.slaDays} {pluralDays(svc.slaDays)} · {svc.resultNote}</div>
          </div>

          {error && <div className="pn-error">{error}</div>}
          <div className="pn-inline">
            <button className="btn" onClick={() => save(false)}>Черновик</button>
            <button className="btn btn--primary" onClick={() => save(true)}>Опубликовать в Mini App</button>
          </div>
        </section>
      </div>
    </>
  );
}
