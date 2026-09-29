import { useMemo, useState } from 'react';
import type { DB, ServiceRequest, StoredFile } from '../shared/types';
import { STATUS_LABEL } from '../shared/types';
import {
  attachResult, completeRequest, detachResult, generateResult, isOverdue, rejectRequest, requestClarification,
  serviceById, studentById, takeInWork,
} from '../shared/api';
import { dayMonth, ddmm, ddmmyyyy, hhmm, minutesAgo, pluralDays } from '../shared/dates';
import { fileToStored, formatSize } from '../shared/pdf';
import { BACKEND } from '../shared/mode';
import { FileViewer, RequestChip } from '../shared/ui';
import { IconFile } from '../shared/icons';

// ——— 3.1 Очередь заявок ———

type QFilter = 'all' | 'new' | 'work' | 'overdue' | 'closed';

const FILTERS: { id: QFilter; label: string; test: (r: ServiceRequest) => boolean }[] = [
  { id: 'all', label: 'Все', test: () => true },
  { id: 'new', label: 'Новые', test: (r) => r.status === 'accepted' },
  { id: 'work', label: 'В работе', test: (r) => r.status === 'in_progress' || r.status === 'need_info' },
  { id: 'overdue', label: 'Просроченные', test: isOverdue },
  { id: 'closed', label: 'Завершённые', test: (r) => r.status === 'done' || r.status === 'rejected' },
];

const ORDER: Record<ServiceRequest['status'], number> = { accepted: 0, in_progress: 1, need_info: 2, done: 3, rejected: 4 };

export function Queue({ db, tenantId, onOpen }: { db: DB; tenantId: string; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState<QFilter>('all');
  const all = db.requests.filter((r) => r.tenantId === tenantId);
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = all
    .filter(f.test)
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'accepted' ? b.createdAt.localeCompare(a.createdAt) : a.deadline.localeCompare(b.deadline)));

  return (
    <>
      <header className="pn-head">
        <div>
          <h1>Очередь заявок</h1>
          <p>Входящие · список</p>
        </div>
      </header>
      <div className="pn-body">
        <div className="pn-filters" role="tablist" aria-label="Фильтр очереди">
          {FILTERS.map((x) => {
            const n = all.filter(x.test).length;
            return (
              <button key={x.id} role="tab" aria-selected={filter === x.id} className={filter === x.id ? 'is-active' : ''} onClick={() => setFilter(x.id)}>
                {x.label}
                {x.id !== 'all' && n > 0 && <span className="tnum">{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="pn-table-wrap">
          <table className="pn-table">
            <thead>
              <tr>
                <th>ФИО студента</th>
                <th>Группа</th>
                <th>Тип запроса</th>
                <th>Дедлайн</th>
                <th>Статус</th>
                <th aria-label="Действие" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = studentById(db, r.studentId);
                const svc = serviceById(db, r.serviceId);
                const fresh = r.status === 'accepted' && minutesAgo(r.createdAt) < 30;
                return (
                  <tr key={r.id} className={fresh ? 'is-fresh' : ''} onClick={() => onOpen(r.id)}>
                    <td>
                      <div className="pn-table__name">{st?.fullName}</div>
                      <div className="pn-table__num tnum">№{r.id}{fresh ? ' · только что' : ''}{r.channel === 'bot' ? ' · из бота' : ''}</div>
                    </td>
                    <td>{st?.group}</td>
                    <td>{svc?.title}</td>
                    <td className={`tnum ${isOverdue(r) ? 'is-late' : ''}`}>{ddmm(r.deadline)}</td>
                    <td><RequestChip r={r} /></td>
                    <td className="pn-table__act">
                      {r.status === 'accepted' ? (
                        <button className="btn btn--primary" onClick={(e) => { e.stopPropagation(); onOpen(r.id); takeInWork(r.id).catch(() => undefined); }}>
                          Взять в работу
                        </button>
                      ) : (
                        <button className="btn" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>Открыть</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr className="pn-table__empty"><td colSpan={6}>В этом фильтре заявок нет.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ——— 3.2 Карточка обработки ———

type Panel = null | 'clarify' | 'reject';

export function RequestCard({ db, requestId, onBack }: { db: DB; requestId: number; onBack: () => void }) {
  const r = db.requests.find((x) => x.id === requestId);
  const [panel, setPanel] = useState<Panel>(null);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [resultNote, setResultNote] = useState('');
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<StoredFile | null>(null);

  const messages = useMemo(
    () => db.messages.filter((m) => m.requestId === requestId && m.audience === 'student'),
    [db.messages, requestId],
  );

  if (!r) {
    return (
      <>
        <header className="pn-head"><div><h1>Карточка заявки</h1><p>Заявка не найдена</p></div></header>
        <div className="pn-body"><button className="btn" onClick={onBack}>← К очереди</button></div>
      </>
    );
  }

  const svc = serviceById(db, r.serviceId)!;
  const st = studentById(db, r.studentId)!;
  const closed = r.status === 'done' || r.status === 'rejected';
  const isPdf = svc.resultType === 'pdf';

  const [busy, setBusy] = useState(false);
  const run = async (fn: () => unknown) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const MAX_INLINE = BACKEND ? 10_000_000 : 2_500_000;
  const onUpload = async (file?: File) => {
    if (!file) return;
    const okType = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) || file.type.startsWith('image/');
    if (!okType) {
      setError('Прикрепите PDF (или скан в JPG/PNG).');
      return;
    }
    if (BACKEND && file.size > MAX_INLINE) {
      setError('Файл больше 10 МБ. Сожмите PDF и прикрепите ещё раз.');
      return;
    }
    const stored = await fileToStored(file, MAX_INLINE);
    if (!stored.mime || stored.mime === 'application/octet-stream') stored.mime = 'application/pdf';
    const ok = await run(() => attachResult(r.id, stored));
    if (ok && !BACKEND && file.size > MAX_INLINE) setError('Файл больше 2,5 МБ: в демо без сервера сохранится только имя.');
  };

  const canFinish = r.status === 'in_progress' || r.status === 'need_info';
  const finish = () =>
    run(async () => {
      if (svc.resultType === 'visit' && !resultNote.trim() && !r.result) {
        throw new Error('Напишите, где и когда забрать результат, или прикрепите документ.');
      }
      await completeRequest(r.id, resultNote.trim() || undefined);
      setResultNote('');
    });
  const uploadLabel = (id: string, text: string, extra = '') => (
    <label className={`btn ${extra}`} htmlFor={id}>
      {text}
      <input id={id} type="file" accept=".pdf,application/pdf,image/*" hidden
        onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
    </label>
  );

  const dl: [string, string][] = [
    ['ФИО', st.fullName],
    ['Группа', st.group],
    ['Факультет', st.facultyFull],
    ...svc.fields
      .filter((f) => r.values[f.id])
      .map((f): [string, string] => [f.label, f.type === 'date' ? ddmmyyyy(r.values[f.id]) : r.values[f.id]]),
    ['Срок', `${svc.slaDays} ${pluralDays(svc.slaDays)} · ${dayMonth(r.deadline)}`],
    ['Отдел', svc.department],
    ['Канал', r.channel === 'bot' ? 'Бот MAX → Mini App' : 'Mini App'],
  ];
  const studentFiles = Object.entries(r.files);

  return (
    <>
      <header className="pn-head">
        <div>
          <h1>Карточка заявки</h1>
          <p>№{r.id} · {svc.title.toLowerCase()}</p>
        </div>
        <button className="btn" onClick={onBack}>← К очереди</button>
      </header>
      <div className="pn-body pn-card-grid">
        <article className="pn-card">
          <div className="pn-card__head">
            <div>
              <div className="pn-card__num tnum">№{r.id}</div>
              <h2>{svc.title}</h2>
            </div>
            <RequestChip r={r} />
          </div>
          <div className="pn-card__body">
            <dl className="pn-dl">
              {dl.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>

            {studentFiles.length > 0 && (
              <div className="pn-files">
                {studentFiles.map(([k, f]) => (
                  <button key={k} className="pn-file" onClick={() => setViewer(f)}>
                    <IconFile size={18} /> {f.name} <span>{formatSize(f.size)}</span>
                  </button>
                ))}
              </div>
            )}

            {!closed && (
              <div className="pn-actions">
                <button className="btn btn--primary" disabled={r.status !== 'accepted'} onClick={() => run(() => takeInWork(r.id))}>
                  {r.status === 'accepted' ? 'Взять в работу' : 'В работе'}
                </button>
                <button className={`btn ${panel === 'clarify' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'clarify' ? null : 'clarify')}>
                  Запросить уточнение
                </button>
                {uploadLabel('pn-upload', r.result ? 'Заменить файл' : 'Прикрепить готовый файл', canFinish ? '' : 'is-disabled')}
                <button className="btn" disabled={!canFinish} onClick={finish}>Завершить</button>
                <button className={`btn btn--danger ${panel === 'reject' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'reject' ? null : 'reject')}>
                  Отказ
                </button>
              </div>
            )}
            {error && <div className="pn-error">{error}</div>}

            {r.status === 'need_info' && (
              <div className="pn-box pn-box--wait">
                <b>Ждём ответ студента</b>
                <span>Запрос: «{r.clarification}»</span>
              </div>
            )}
            {r.studentReply && r.status !== 'need_info' && (
              <div className="pn-box pn-box--reply">
                <b>Студент дополнил заявку</b>
                <span>«{r.studentReply}»</span>
              </div>
            )}

            {panel === 'clarify' && !closed && (
              <div className="pn-box pn-box--clarify">
                <label htmlFor="pn-comment"><b>Комментарий к уточнению</b></label>
                <textarea id="pn-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="Уточните название банка и срок, на который нужна справка" />
                <div>
                  <button className="btn btn--primary" disabled={!comment.trim()}
                    onClick={() => run(async () => { await requestClarification(r.id, comment.trim()); setComment(''); setPanel(null); })}>
                    Отправить студенту в бот
                  </button>
                </div>
              </div>
            )}

            {panel === 'reject' && !closed && (
              <div className="pn-box pn-box--clarify">
                <label htmlFor="pn-reason"><b>Причина отказа</b></label>
                <textarea id="pn-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Например: студент отчислен, справка не может быть выдана" />
                <div>
                  <button className="btn btn--danger" disabled={!reason.trim()}
                    onClick={() => run(async () => { await rejectRequest(r.id, reason.trim()); setPanel(null); })}>
                    Отклонить заявку
                  </button>
                </div>
              </div>
            )}

            {canFinish && (
              <div className="pn-box pn-box--answer">
                <b>Ответ студенту</b>
                {r.result ? (
                  <div className="pn-attached">
                    <IconFile size={20} />
                    <div>
                      <div className="pn-attached__name">{r.result.name}</div>
                      <div className="pn-attached__meta">{formatSize(r.result.size)} · после «Готово» уйдёт в бот и в Mini App</div>
                      {r.result.signature && (
                        <div className="pn-attached__sig">
                          ✓ Подписан ЭП · № {r.result.signature.docId} ·{' '}
                          <a href={`/verify/${r.result.signature.docId}`} target="_blank" rel="noreferrer">проверить</a>
                        </div>
                      )}
                    </div>
                    <div className="pn-inline">
                      <button className="btn" onClick={() => setViewer(r.result!)}>Просмотр</button>
                      <button className="btn btn--danger" onClick={() => run(() => detachResult(r.id))}>Убрать</button>
                    </div>
                  </div>
                ) : (
                  <div className="pn-attach-empty">
                    <span>
                      {isPdf
                        ? BACKEND
                          ? 'Нужен готовый документ: сформируйте справку по шаблону — PDF с электронной подписью вуза и QR-кодом проверки. Или загрузите свой PDF — он тоже будет подписан.'
                          : 'Нужен готовый документ: сформируйте справку по шаблону или загрузите скан с подписью и печатью.'
                        : 'Прикрепите PDF, если по заявке есть документ: приказ, решение, выписка. Можно ограничиться комментарием.'}
                    </span>
                    <div className="pn-inline">
                      {uploadLabel('pn-upload-2', 'Прикрепить PDF', 'btn--primary-soft')}
                      {isPdf && <button className="btn" disabled={busy} onClick={() => run(() => generateResult(r.id))}>Сформировать по шаблону</button>}
                    </div>
                  </div>
                )}
                <label htmlFor="pn-result" className="pn-box__label">Комментарий {svc.resultType === 'visit' ? '' : '(необязательно)'}</label>
                <textarea id="pn-result" rows={2} value={resultNote} onChange={(e) => setResultNote(e.target.value)}
                  placeholder={
                    svc.resultType === 'visit' ? 'Ждём вас 30.09 в 11:00, каб. 214'
                      : isPdf ? 'Оригинал с печатью можно забрать в каб. 105'
                        : 'Решение принято, приказ № 512 от 30.09'
                  } />
                <div>
                  <button className="btn btn--primary" onClick={finish}
                    disabled={busy || (isPdf && !r.result) || (svc.resultType === 'visit' && !resultNote.trim() && !r.result)}>
                    Отметить «Готово» и отправить
                  </button>
                </div>
              </div>
            )}

            {r.status === 'done' && (
              <div className="pn-box pn-box--done">
                <b>Заявка выполнена</b>
                {r.resultNote && <span className="pn-box__green">{r.resultNote}</span>}
                {r.result && (
                  <div className="pn-inline">
                    <button className="pn-file" onClick={() => setViewer(r.result!)}>
                      <IconFile size={18} /> {r.result.name} <span>{formatSize(r.result.size)}</span>
                    </button>
                    <span className="pn-box__green">
                      Отправлен студенту в бот и в Mini App{r.result.signature ? ` · подписан ЭП, № ${r.result.signature.docId}` : ''}
                    </span>
                  </div>
                )}
              </div>
            )}
            {r.status === 'rejected' && (
              <div className="pn-box pn-box--grey">
                <b>Заявка отклонена</b>
                <span>{r.rejectReason}</span>
              </div>
            )}
          </div>
        </article>

        <aside className="pn-aside">
          <h3>История</h3>
          <ol className="pn-history">
            {r.history.map((h, i) => (
              <li key={i}>
                <span className="pn-history__status">{STATUS_LABEL[h.status]}</span>
                <span className="pn-history__note">{h.note}</span>
                <span className="pn-history__time tnum">{ddmm(h.at)} {hhmm(h.at)}</span>
              </li>
            ))}
          </ol>

          <h3>Студенту в MAX</h3>
          {messages.length === 0 ? (
            <p className="pn-aside__empty">Сообщения по заявке появятся здесь после действий в карточке.</p>
          ) : (
            <ul className="pn-bot">
              {messages.map((m) => (
                <li key={m.id}>
                  <div className="pn-bot__text">{m.text}</div>
                  <div className="pn-bot__meta">
                    {m.buttons.map((b) => <span key={b.label} className="pn-bot__btn">{b.label}</span>)}
                    <span className="tnum">{hhmm(m.at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {viewer && <FileViewer file={viewer} onClose={() => setViewer(null)} />}
    </>
  );
}
