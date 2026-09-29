import { useCallback, useEffect, useMemo, useState } from 'react';
import './miniapp.css';
import type { CategoryId, DB, Service, ServiceField, ServiceRequest, StoredFile, Student } from '../shared/types';
import { CATEGORIES, STATUS_LABEL } from '../shared/types';
import { getDB, useBus, useDB, usePersistent } from '../shared/store';
import {
  createRequest, isActive, loginStudent, logoutStudent, rateRequest, replyToClarification, serviceById, tenantById,
} from '../shared/api';
import { BACKEND } from '../shared/mode';
import { AuthRequired, fetchPublicTenants, getToken, syncStudent, trySessionFromMax, type PublicTenant } from '../shared/backend';
import { ddmm, ddmmyyyy, hhmm, pluralDays, relDay } from '../shared/dates';
import { downloadStoredFile, getStartParam, haptic, isInsideMax, openExternal, setBackButton, verifyHref } from '../shared/max';
import { fileToStored, formatSize } from '../shared/pdf';
import {
  IconCheck, IconClose, IconFile, IconProfile, IconRequests, IconSearch, IconServices, IconUpload,
} from '../shared/icons';
import { FileViewer, RequestChip, Toasts, useOnNew, useToasts } from '../shared/ui';

// Mini App студента: Услуги → Форма → Мои заявки → Карточка → Профиль.
// Экраны 2.1–2.3 макета. Бот (1.1) живёт в MAX и открывает эти экраны через start_param.

type Screen =
  | { name: 'home' }
  | { name: 'form'; serviceId: string; draftId?: string }
  | { name: 'submitted'; requestId: number }
  | { name: 'requests' }
  | { name: 'request'; requestId: number }
  | { name: 'profile' };

type ReqFilter = 'all' | 'active' | 'done';

export default function MiniApp({ framed = false }: { framed?: boolean }) {
  const db = useDB();
  const [session, setSession] = usePersistent<{ studentId: string } | null>('uniflow.student', null);
  const student = session ? db.students.find((s) => s.id === session.studentId) : undefined;

  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [reqFilter, setReqFilter] = useState<ReqFilter>('all');
  const { toasts, push } = useToasts(3600);
  const [ready, setReady] = useState(!BACKEND);
  const [pendingStart, setPendingStart] = useState<string | null>(() => getStartParam());
  const [mountedAt] = useState(() => new Date().toISOString());

  // Режим с сервером: восстановить сессию (в MAX — автоматически по initData) и загрузить данные
  useEffect(() => {
    if (!BACKEND) return;
    let alive = true;
    (async () => {
      let sess = getToken('student') ? session : null;
      if (!sess) {
        const auto = await trySessionFromMax();
        if (auto) sess = { studentId: auto.studentId };
      }
      if (sess) {
        try {
          await syncStudent();
          if (alive) setSession(sess);
        } catch (e) {
          if (e instanceof AuthRequired && alive) setSession(null);
        }
      } else if (session && alive) setSession(null);
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Режим с сервером: подтягивать изменения статусов раз в 4 секунды
  useEffect(() => {
    if (!BACKEND || !ready || !session) return;
    const t = window.setInterval(() => {
      syncStudent().catch((e) => {
        if (e instanceof AuthRequired) setSession(null);
      });
    }, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, session?.studentId]);

  // start_param из MAX: draft_<id> | svc_<id> | req_<id> | requests | home
  useEffect(() => {
    if (!ready || !student || !pendingStart) return;
    const p = pendingStart;
    if (p.startsWith('draft_')) {
      const draft = db.drafts.find((d) => d.id === p.slice(6));
      if (draft) setScreen({ name: 'form', serviceId: draft.serviceId, draftId: draft.id });
    } else if (p.startsWith('svc_')) setScreen({ name: 'form', serviceId: p.slice(4) });
    else if (p.startsWith('req_')) setScreen({ name: 'request', requestId: Number(p.slice(4)) });
    else if (p === 'requests') setScreen({ name: 'requests' });
    setPendingStart(null);
  }, [ready, student, pendingStart, db.drafts]);

  // Команды с демо-стенда (кнопки бота)
  useBus(
    useCallback((e) => {
      if (e.type === 'miniapp:open-draft') {
        const draft = getDB().drafts.find((d) => d.id === e.draftId);
        if (draft) setScreen({ name: 'form', serviceId: draft.serviceId, draftId: draft.id });
      }
      if (e.type === 'miniapp:open-request') setScreen({ name: 'request', requestId: e.requestId });
    }, []),
  );

  // Пуши бота этому студенту — показываем поверх приложения
  const myMessages = useMemo(
    () => (student ? db.messages.filter((m) => m.audience === 'student' && m.studentId === student.id) : []),
    [db.messages, student],
  );
  useOnNew(myMessages, (m) => {
    if (m.at < mountedAt) return; // старые сообщения, подгруженные с сервера
    push({ source: 'MAX · Бот', text: m.text });
    haptic('medium');
  });

  // Кнопка «Назад» MAX
  useEffect(() => {
    const back =
      screen.name === 'form' ? () => setScreen({ name: 'home' })
        : screen.name === 'request' ? () => setScreen({ name: 'requests' })
          : null;
    setBackButton(back);
    return () => setBackButton(null);
  }, [screen]);

  if (!ready) {
    return (
      <div className={`ma ${framed ? 'ma--framed' : ''}`}>
        <Header eyebrow="Mini App" title="Загружаем…" />
        <main className="ma-sheet" aria-busy="true" />
      </div>
    );
  }

  if (!student) {
    return (
      <div className={`ma ${framed ? 'ma--framed' : ''}`}>
        <Login db={db} onLogin={(studentId) => setSession({ studentId })} />
      </div>
    );
  }

  const go = (s: Screen) => {
    setScreen(s);
    haptic();
  };
  const tab = screen.name === 'requests' || screen.name === 'request' ? 'requests' : screen.name === 'profile' ? 'profile' : 'home';

  return (
    <div className={`ma ${framed ? 'ma--framed' : ''}`}>
      {screen.name === 'home' && (
        <Home
          db={db} student={student}
          onOpenService={(id) => go({ name: 'form', serviceId: id })}
          onOpenRequest={(id) => go({ name: 'request', requestId: id })}
          onAllActive={() => { setReqFilter('active'); go({ name: 'requests' }); }}
        />
      )}
      {screen.name === 'form' && (
        <Form
          key={`${screen.serviceId}-${screen.draftId ?? ''}`}
          db={db} student={student} serviceId={screen.serviceId} draftId={screen.draftId}
          onBack={() => go({ name: 'home' })}
          onSubmitted={(id) => go({ name: 'submitted', requestId: id })}
        />
      )}
      {screen.name === 'submitted' && (
        <Submitted
          db={db} requestId={screen.requestId}
          onOpen={() => go({ name: 'request', requestId: screen.requestId })}
          onHome={() => go({ name: 'home' })}
        />
      )}
      {screen.name === 'requests' && (
        <Requests
          db={db} student={student} filter={reqFilter} setFilter={setReqFilter}
          onOpen={(id) => go({ name: 'request', requestId: id })}
        />
      )}
      {screen.name === 'request' && (
        <RequestView db={db} requestId={screen.requestId} onBack={() => go({ name: 'requests' })} />
      )}
      {screen.name === 'profile' && (
        <Profile db={db} student={student} onLogout={() => { logoutStudent(); setSession(null); setScreen({ name: 'home' }); }} />
      )}

      <nav className="ma-tabbar" aria-label="Разделы">
        <button className={tab === 'home' ? 'is-active' : ''} onClick={() => go({ name: 'home' })}>
          <IconServices /> <span>Услуги</span>
        </button>
        <button className={tab === 'requests' ? 'is-active' : ''} onClick={() => go({ name: 'requests' })}>
          <IconRequests /> <span>Заявки</span>
        </button>
        <button className={tab === 'profile' ? 'is-active' : ''} onClick={() => go({ name: 'profile' })}>
          <IconProfile /> <span>Профиль</span>
        </button>
      </nav>
      <Toasts toasts={toasts} />
    </div>
  );
}

// ——— Общие части ———

function Header({ eyebrow, title, sub, onEyebrow }: { eyebrow: string; title: string; sub?: string; onEyebrow?: () => void }) {
  return (
    <header className="ma-head">
      {onEyebrow ? (
        <button className="ma-head__eyebrow ma-head__back" onClick={onEyebrow}>{eyebrow}</button>
      ) : (
        <div className="ma-head__eyebrow">{eyebrow}</div>
      )}
      <h1 className="ma-head__title">{title}</h1>
      {sub && <div className="ma-head__sub">{sub}</div>}
    </header>
  );
}

const shortStudent = (s: Student) => `${s.firstName} ${s.lastName} · ${s.group}`;

// ——— 2.1 Вход через ВУЗ ———

function Login({ db, onLogin }: { db: DB; onLogin: (studentId: string) => void }) {
  const localTenants: PublicTenant[] = db.tenants.map((t) => ({
    id: t.id, name: t.name, short: t.short,
    demoEmail: db.students.find((s) => s.tenantId === t.id)?.email ?? '',
  }));
  const [tenants, setTenants] = useState<PublicTenant[]>(BACKEND ? [] : localTenants);
  const [tenantId, setTenantId] = useState(localTenants[0]?.id ?? '');
  const [email, setEmail] = useState(localTenants[0]?.demoEmail ?? '');
  const [password, setPassword] = useState('demo-pass');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!BACKEND) return;
    fetchPublicTenants()
      .then(({ tenants: list }) => {
        setTenants(list);
        setTenantId(list[0]?.id ?? '');
        setEmail(list[0]?.demoEmail ?? '');
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { studentId } = await loginStudent(tenantId, email, password);
      onLogin(studentId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header eyebrow="Вход" title="ВУЗ" />
      <main className="ma-sheet ma-sheet--plain">
        <div className="ma-testdata" role="note">
          <b>Тестовые данные</b>
          Вузы и студенты вымышленные, вход имитирует SSO вуза: подойдёт логин из подсказки и любой пароль от 4 символов.
        </div>
        <form className="ma-login" onSubmit={submit}>
          <label className="ma-login__label" htmlFor="login-tenant">Вуз</label>
          <select id="login-tenant" className="ma-login__input" value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value);
              setEmail(tenants.find((t) => t.id === e.target.value)?.demoEmail ?? '');
              setError('');
            }}>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label className="ma-login__label" htmlFor="login-email">Логин (студенческий email)</label>
          <input id="login-email" className="ma-login__input" type="email" autoComplete="username"
            value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} />
          <label className="ma-login__label" htmlFor="login-pass">Пароль</label>
          <input id="login-pass" className="ma-login__input" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="ma-error">{error}</div>}
          <button className="btn btn--primary btn--block" type="submit" disabled={busy || !tenantId}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <p className="ma-hint">
          {isInsideMax()
            ? 'После входа профиль привяжется к MAX: бот будет присылать статусы заявок и готовые документы.'
            : 'Вход через учётную запись вуза. После входа ФИО, факультет и группа подставляются в заявки сами, а бот в MAX привязывается к профилю.'}
        </p>
      </main>
    </>
  );
}

// ——— 2.2 Главный экран ———

function Home({ db, student, onOpenService, onOpenRequest, onAllActive }: {
  db: DB; student: Student;
  onOpenService: (id: string) => void; onOpenRequest: (id: number) => void; onAllActive: () => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');

  const services = db.services.filter((s) => s.tenantId === student.tenantId && s.enabled && s.published);
  const cats = CATEGORIES.filter((c) => services.some((s) => s.category === c.id));
  const query = q.trim().toLowerCase();
  const shown = services.filter(
    (s) => (cat === 'all' || s.category === cat)
      && (!query || `${s.title} ${s.description} ${s.meta}`.toLowerCase().includes(query)),
  );

  const active = db.requests
    .filter((r) => r.studentId === student.id && isActive(r))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const top = active[0];

  return (
    <>
      <Header eyebrow="Mini App" title="Услуги" sub={shortStudent(student)} />
      <main className="ma-sheet">
        <label className="ma-search">
          <IconSearch />
          <input type="search" placeholder="Найти услугу…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Найти услугу" />
        </label>

        {top && !query && (
          <section className="ma-widget">
            <div className="ma-widget__eyebrow">Активные заявки{active.length > 1 ? ` · ${active.length}` : ''}</div>
            <button className="ma-widget__title" onClick={() => onOpenRequest(top.id)}>
              №{top.id} · {serviceById(db, top.serviceId)?.title}
            </button>
            <div className="ma-widget__row">
              <span className={`chip chip--${top.status} ma-widget__chip`}>{STATUS_LABEL[top.status]}</span>
              <span>Обновлено {relDay(top.updatedAt)}</span>
            </div>
            <button className="ma-widget__all" onClick={onAllActive}>Все →</button>
          </section>
        )}

        <div className="ma-chips" role="tablist" aria-label="Категории">
          <button role="tab" aria-selected={cat === 'all'} className={cat === 'all' ? 'is-active' : ''} onClick={() => setCat('all')}>Все</button>
          {cats.map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'is-active' : ''} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        {shown.map((s) => (
          <button key={s.id} className="ma-card ma-card--link" onClick={() => onOpenService(s.id)}>
            <span className="ma-card__title">{s.title}</span>
            <span className="ma-card__sub">{s.meta}</span>
          </button>
        ))}
        {shown.length === 0 && (
          <div className="ma-empty">
            Ничего не нашли по запросу «{q}». Напишите боту в MAX своими словами — он подберёт услугу.
          </div>
        )}
      </main>
    </>
  );
}

// ——— 2.3 Форма заявки ———

function Form({ db, student, serviceId, draftId, onBack, onSubmitted }: {
  db: DB; student: Student; serviceId: string; draftId?: string;
  onBack: () => void; onSubmitted: (id: number) => void;
}) {
  const svc = serviceById(db, serviceId);
  const draft = draftId ? db.drafts.find((d) => d.id === draftId) : undefined;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(draft?.values ?? {}) }));
  const [files, setFiles] = useState<Record<string, StoredFile>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  if (!svc || !svc.enabled) {
    return (
      <>
        <Header eyebrow="← Назад" title="Услуга недоступна" onEyebrow={onBack} />
        <main className="ma-sheet"><div className="ma-empty">Вуз выключил эту услугу. Выберите другую в каталоге.</div></main>
      </>
    );
  }

  const set = (id: string, v: string) => {
    setValues((p) => ({ ...p, [id]: v }));
    setErrors((p) => ({ ...p, [id]: '' }));
  };

  const pickFile = async (f: ServiceField, file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrors((p) => ({ ...p, [f.id]: 'Файл больше 5 МБ. Сожмите его или загрузите другой.' }));
      return;
    }
    const stored = await fileToStored(file, BACKEND ? 6_000_000 : 1_500_000);
    setFiles((p) => ({ ...p, [f.id]: stored }));
    set(f.id, stored.name);
  };

  const submit = () => {
    const errs: Record<string, string> = {};
    for (const f of svc.fields) if (f.required && !values[f.id]?.trim()) errs[f.id] = f.type === 'file' ? 'Прикрепите файл' : 'Заполните поле';
    setErrors(errs);
    if (Object.keys(errs).length) {
      haptic('medium');
      return;
    }
    setBusy(true);
    setFormError('');
    createRequest({
      studentId: student.id, serviceId: svc.id, values, files,
      channel: draft ? 'bot' : 'miniapp', draftId: draft?.id,
    })
      .then((r) => onSubmitted(r.id))
      .catch((e) => {
        setFormError((e as Error).message);
        setBusy(false);
        haptic('medium');
      });
  };

  return (
    <>
      <Header eyebrow="← Назад" title={svc.title} onEyebrow={onBack} />
      <main className="ma-sheet ma-sheet--action">
        <p className="ma-sla">До {svc.slaDays} {pluralDays(svc.slaDays)} · {svc.resultNote}</p>
        {formError && <div className="ma-note ma-note--error" role="alert">{formError}</div>}

        {draft && (
          <div className="ma-note">
            Бот заполнил форму по сообщению «{draft.sourceText}». Проверьте данные и отправьте.
          </div>
        )}

        <div className="ma-field ma-field--locked">
          <span className="ma-field__label">ФИО</span>
          <span className="ma-field__value">{student.fullName}</span>
        </div>
        <div className="ma-field ma-field--locked">
          <span className="ma-field__label">Факультет / группа</span>
          <span className="ma-field__value">{student.faculty} · {student.group}</span>
        </div>

        {svc.fields.map((f) => (
          <FieldInput key={f.id} field={f} value={values[f.id] ?? ''} file={files[f.id]} error={errors[f.id]}
            onChange={(v) => set(f.id, v)} onFile={(file) => pickFile(f, file)}
            onClearFile={() => { setFiles((p) => { const n = { ...p }; delete n[f.id]; return n; }); set(f.id, ''); }} />
        ))}
      </main>
      <div className="ma-action">
        <button className="btn btn--primary btn--block" onClick={submit} disabled={busy}>{busy ? 'Отправляем…' : 'Отправить'}</button>
      </div>
    </>
  );
}

function FieldInput({ field: f, value, file, error, onChange, onFile, onClearFile }: {
  field: ServiceField; value: string; file?: StoredFile; error?: string;
  onChange: (v: string) => void; onFile: (f: File | undefined) => void; onClearFile: () => void;
}) {
  const id = `f-${f.id}`;
  const label = <label className="ma-field__label" htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>;

  if (f.type === 'file') {
    return (
      <div className={`ma-upload ${error ? 'has-error' : ''}`}>
        {file ? (
          <div className="ma-upload__file">
            <IconFile />
            <div>
              <div className="ma-upload__name">{file.name}</div>
              <div className="ma-upload__meta">{f.label} · {formatSize(file.size)}</div>
            </div>
            <button className="icon-btn" onClick={onClearFile} aria-label="Убрать файл"><IconClose /></button>
          </div>
        ) : (
          <label className="ma-upload__drop" htmlFor={id}>
            <span className="ma-upload__cta"><IconUpload /> {f.label}{f.required ? ' *' : ''}</span>
            <span className="ma-upload__meta">PDF, JPG до 5 МБ</span>
          </label>
        )}
        <input id={id} type="file" accept=".pdf,image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {error && <div className="ma-field__error">{error}</div>}
      </div>
    );
  }

  return (
    <div className={`ma-field ${error ? 'has-error' : ''}`}>
      {label}
      {f.type === 'select' ? (
        <div className="ma-select">
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>Выберите…</option>
            {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      ) : f.type === 'textarea' ? (
        <textarea id={id} rows={3} placeholder={f.placeholder ?? 'Кратко опишите…'} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
          placeholder={f.placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && <div className="ma-field__error">{error}</div>}
    </div>
  );
}

function Submitted({ db, requestId, onOpen, onHome }: { db: DB; requestId: number; onOpen: () => void; onHome: () => void }) {
  const r = db.requests.find((x) => x.id === requestId);
  const svc = r && serviceById(db, r.serviceId);
  return (
    <>
      <Header eyebrow="Mini App" title="Заявка отправлена" />
      <main className="ma-sheet ma-sheet--action">
        <div className="ma-card ma-done">
          <span className="ma-done__icon"><IconCheck size={22} /></span>
          <div className="ma-card__title">Заявка №{requestId} принята</div>
          <div className="ma-card__sub">
            {svc?.title}. Статус: Принято. Срок: до {r ? ddmm(r.deadline) : '—'}.
          </div>
          <div className="ma-card__sub">Изменения статуса придут в чат с ботом в MAX.</div>
        </div>
      </main>
      <div className="ma-action ma-action--stack">
        <button className="btn btn--primary btn--block" onClick={onOpen}>Открыть заявку</button>
        <button className="btn btn--block" onClick={onHome}>К услугам</button>
      </div>
    </>
  );
}

// ——— 2.3 Мои заявки ———

function Requests({ db, student, filter, setFilter, onOpen }: {
  db: DB; student: Student; filter: ReqFilter; setFilter: (f: ReqFilter) => void; onOpen: (id: number) => void;
}) {
  const mine = db.requests
    .filter((r) => r.studentId === student.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = mine.filter((r) => (filter === 'all' ? true : filter === 'active' ? isActive(r) : !isActive(r)));

  return (
    <>
      <Header eyebrow="Mini App" title="Мои заявки" />
      <main className="ma-sheet">
        <div className="ma-chips" role="tablist" aria-label="Фильтр заявок">
          {([['all', 'Все'], ['active', 'Активные'], ['done', 'Готовые']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'is-active' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        {shown.map((r) => (
          <button key={r.id} className="ma-card ma-card--link" onClick={() => onOpen(r.id)}>
            <span className="ma-card__title ma-card__title--chip">
              {serviceById(db, r.serviceId)?.title} <RequestChip r={r} />
            </span>
            <span className="ma-card__sub tnum">№{r.id} · обновлено {relDay(r.updatedAt)}</span>
            {r.status === 'need_info' && <span className="ma-card__alert">Нужно дополнить заявку</span>}
          </button>
        ))}
        {shown.length === 0 && (
          <div className="ma-empty">
            {filter === 'done' ? 'Готовых заявок пока нет.' : 'Активных заявок нет. Выберите услугу в каталоге.'}
          </div>
        )}
      </main>
    </>
  );
}

// ——— 2.3 Карточка заявки ———

function describeValues(svc: Service | undefined, r: ServiceRequest) {
  if (!svc) return '';
  return svc.fields
    .filter((f) => r.values[f.id] && f.type !== 'file')
    .map((f) => `${f.label}: ${f.type === 'date' ? ddmmyyyy(r.values[f.id]) : r.values[f.id]}`)
    .join(' · ');
}

function RequestView({ db, requestId, onBack }: { db: DB; requestId: number; onBack: () => void }) {
  const r = db.requests.find((x) => x.id === requestId);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState('');
  const [viewer, setViewer] = useState(false);

  if (!r) {
    return (
      <>
        <Header eyebrow="← К списку" title={`№${requestId}`} onEyebrow={onBack} />
        <main className="ma-sheet"><div className="ma-empty">Заявка не найдена.</div></main>
      </>
    );
  }
  const svc = serviceById(db, r.serviceId);
  const details = describeValues(svc, r);
  const showResult = r.status === 'done' && r.result ? r.result : undefined;
  const isPdfFile = showResult?.mime === 'application/pdf';
  const attached = Object.values(r.files);

  return (
    <>
      <Header eyebrow="← К списку" title={`№${r.id} · ${STATUS_LABEL[r.status]}`} onEyebrow={onBack} />
      <main className={`ma-sheet ${showResult ? 'ma-sheet--action' : ''}`}>
        <div className="ma-card">
          <span className="ma-card__title ma-card__title--chip">{svc?.title} <RequestChip r={r} /></span>
          <span className="ma-card__sub">
            {details ? `${details} · ` : ''}подана {ddmmyyyy(r.createdAt)}
          </span>
          {isActive(r) && <span className="ma-card__sub">Срок: до {ddmm(r.deadline)} · {svc?.department}</span>}
          {attached.length > 0 && (
            <span className="ma-card__sub">Вложения: {attached.map((f) => f.name).join(', ')}</span>
          )}
        </div>

        {r.status === 'need_info' && (
          <div className="ma-card ma-clarify">
            <span className="ma-card__title">Нужны данные</span>
            <p className="ma-clarify__text">«{r.clarification}»</p>
            <label className="ma-field__label" htmlFor="reply">Ваш ответ</label>
            <textarea id="reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Например: подойдёт 11:00 в тот же день" />
            <button className="btn btn--primary btn--block" disabled={!reply.trim()}
              onClick={() => {
                replyToClarification(r.id, reply.trim())
                  .then(() => { setReply(''); setReplyError(''); haptic('medium'); })
                  .catch((e) => setReplyError((e as Error).message));
              }}>
              Дополнить заявку
            </button>
            {replyError && <div className="ma-error">{replyError}</div>}
          </div>
        )}

        {r.status === 'rejected' && (
          <div className="ma-card ma-rejected">
            <span className="ma-card__title">Заявка отклонена</span>
            <span className="ma-card__sub">{r.rejectReason}</span>
          </div>
        )}

        <div className="ma-card">
          <span className="ma-card__title">История статусов</span>
          <ul className="ma-history tnum">
            {r.history.map((h, i) => (
              <li key={i}>{ddmm(h.at)} {hhmm(h.at)} {STATUS_LABEL[h.status]} — {h.note}</li>
            ))}
          </ul>
        </div>

        {showResult && <DocCard file={showResult} onOpen={() => setViewer(true)} />}
        {r.status === 'done' && r.resultNote && (
          <div className="ma-card ma-result-note">
            <span className="ma-card__title">Результат</span>
            <span className="ma-card__sub">{r.resultNote}</span>
          </div>
        )}
        {r.status === 'done' && <RateCard r={r} />}
      </main>
      {showResult && (
        <div className="ma-action">
          <button className="btn btn--primary btn--block" onClick={() => { haptic('light'); void downloadStoredFile(showResult); }}>
            {isPdfFile ? 'Скачать PDF' : 'Скачать файл'}
          </button>
        </div>
      )}
      {viewer && showResult && <FileViewer file={showResult} onClose={() => setViewer(false)} />}
    </>
  );
}

// ——— Готовый документ: превью, подпись, действия ———

function DocCard({ file, onOpen }: { file: StoredFile; onOpen: () => void }) {
  const isPdf = file.mime === 'application/pdf';
  const sig = file.signature;
  return (
    <div className="ma-card ma-doc">
      <button className="ma-doc__main" onClick={onOpen} aria-label={`Открыть ${file.name}`}>
        <span className="ma-doc__thumb">
          {file.previewUrl ? <img src={file.previewUrl} alt="" /> : <span className="ma-doc__ext">{isPdf ? 'PDF' : 'FILE'}</span>}
        </span>
        <span className="ma-doc__info">
          <span className="ma-card__title">{file.name}</span>
          <span className="ma-card__sub">{isPdf ? 'PDF-документ' : 'Файл'} · {formatSize(file.size)}</span>
          {sig && (
            <span className="ma-doc__sig">
              <span>✓ Подписан электронной подписью</span>
              <span className="ma-doc__sigmeta">№ {sig.docId} · {sig.signer}</span>
            </span>
          )}
        </span>
      </button>
      <div className="ma-doc__actions">
        <button className="btn" onClick={onOpen}>Открыть</button>
        {sig && <button className="btn" onClick={() => openExternal(verifyHref(sig.docId))}>Проверить подпись</button>}
      </div>
      <span className="ma-doc__hint">
        Этот же файл пришёл в чат с ботом — его можно переслать в банк, МФЦ или работодателю прямо из MAX.
      </span>
    </div>
  );
}

// ——— Оценка услуги (обратная связь для вуза) ———

function RateCard({ r }: { r: ServiceRequest }) {
  const [score, setScore] = useState<number>(r.rating?.score ?? 0);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(!r.rating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (r.rating && !editing) {
    return (
      <div className="ma-card ma-rate">
        <span className="ma-card__title">Ваша оценка: {r.rating.score} из 5</span>
        {r.rating.comment && <span className="ma-card__sub">«{r.rating.comment}»</span>}
        <button className="ma-link" onClick={() => setEditing(true)}>Изменить</button>
      </div>
    );
  }
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await rateRequest(r.id, r.studentId, score, comment.trim() || undefined);
      setEditing(false);
      haptic('medium');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ma-card ma-rate">
      <span className="ma-card__title">Как прошло оформление?</span>
      <span className="ma-card__sub">Оценка поможет вузу убрать лишние шаги.</span>
      <div className="ma-stars" role="radiogroup" aria-label="Оценка от 1 до 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={score === n} aria-label={`${n} из 5`}
            className={n <= score ? 'is-on' : ''} onClick={() => setScore(n)}>★</button>
        ))}
      </div>
      {score > 0 && score <= 3 && (
        <textarea id={`rate-${r.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder="Что пошло не так? Например: пришлось идти в деканат" aria-label="Комментарий к оценке" />
      )}
      {error && <div className="ma-error">{error}</div>}
      <button className="btn btn--primary btn--block" disabled={!score || busy} onClick={send}>
        {busy ? 'Сохраняем…' : 'Отправить оценку'}
      </button>
    </div>
  );
}

// ——— Профиль ———

function Profile({ db, student, onLogout }: { db: DB; student: Student; onLogout: () => void }) {
  const t = tenantById(db, student.tenantId);
  const rows: [string, string][] = [
    ['Вуз', t.name],
    ['Факультет', student.facultyFull],
    ['Группа', `${student.group} · ${student.course} курс`],
    ['Email', student.email],
  ];
  return (
    <>
      <Header eyebrow="Mini App" title="Профиль" sub={shortStudent(student)} />
      <main className="ma-sheet">
        <div className="ma-card">
          <span className="ma-card__title">{student.fullName}</span>
          <dl className="ma-dl">
            {rows.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
        <div className="ma-card">
          <span className="ma-card__title ma-card__title--chip">Бот в MAX <span className="chip chip--done">Привязан</span></span>
          <span className="ma-card__sub">Статусы заявок и готовые документы приходят в чат с ботом.</span>
        </div>
        <button className="btn btn--block" onClick={onLogout}>Выйти из профиля</button>
      </main>
    </>
  );
}
