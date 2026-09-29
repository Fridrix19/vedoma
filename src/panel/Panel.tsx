import { useCallback, useEffect, useMemo, useState } from 'react';
import './panel.css';
import type { PanelRole } from '../shared/types';
import { getDB, useBus, useDB, usePersistent } from '../shared/store';
import { setPanelTenant, tenantById, tenantStats } from '../shared/api';
import { BACKEND } from '../shared/mode';
import { AuthRequired, getToken, http, setToken, syncPanel } from '../shared/backend';
import { Toasts, useOnNew, useToasts } from '../shared/ui';
import { Queue, RequestCard } from './Staff';
import { Builder, Dashboard } from './Admin';

// Веб-панель вуза: сотрудник деканата (задачи 3.1–3.2) и администратор (4.1–4.2).

type StaffView = { name: 'queue' } | { name: 'card'; requestId: number };
type AdminView = { name: 'dashboard' } | { name: 'builder'; serviceId: string | null };

export default function Panel({ framed = false }: { framed?: boolean }) {
  const db = useDB();
  const [session, setSession] = usePersistent<{ role: PanelRole; tenantId: string }>('uniflow.panel', {
    role: 'staff',
    tenantId: 'univ-a',
  });
  const [staffView, setStaffView] = useState<StaffView>({ name: 'queue' });
  const [lastCard, setLastCard] = useState<number | null>(null);
  const [adminView, setAdminView] = useState<AdminView>({ name: 'dashboard' });
  const { toasts, push } = useToasts(5000);
  const [authed, setAuthed] = useState(() => !BACKEND || Boolean(getToken('panel')));
  const [loadedTenant, setLoadedTenant] = useState<string | null>(BACKEND ? null : session.tenantId);
  const [mountedAt] = useState(() => new Date().toISOString());

  // Режим с сервером: загрузка данных выбранного вуза и обновление раз в 4 секунды
  useEffect(() => {
    if (!BACKEND || !authed) return;
    let alive = true;
    setPanelTenant(session.tenantId);
    const load = () =>
      syncPanel(session.tenantId)
        .then(() => alive && setLoadedTenant(session.tenantId))
        .catch((e) => {
          if (e instanceof AuthRequired && alive) setAuthed(false);
        });
    load();
    const t = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [authed, session.tenantId]);

  // Ссылка из бота: panel.html#req-18425 открывает карточку заявки
  useEffect(() => {
    const m = /^#req-(\d+)$/.exec(window.location.hash);
    if (m && loadedTenant) {
      setSession({ ...session, role: 'staff' });
      setStaffView({ name: 'card', requestId: Number(m[1]) });
      setLastCard(Number(m[1]));
      history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedTenant]);

  const openCard = (id: number) => {
    setStaffView({ name: 'card', requestId: id });
    setLastCard(id);
  };

  useBus(
    useCallback(
      (e) => {
        if (e.type === 'panel:open-request') {
          const r = getDB().requests.find((x) => x.id === e.requestId);
          setSession({ role: 'staff', tenantId: r?.tenantId ?? session.tenantId });
          openCard(e.requestId);
        }
        if (e.type === 'panel:new-service') {
          setSession({ ...session, role: 'admin' });
          setAdminView({ name: 'builder', serviceId: null });
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [session],
    ),
  );

  // Уведомления сотруднику (в проде это тот же бот MAX, чат деканата)
  const staffMessages = useMemo(
    () => db.messages.filter((m) => m.audience === 'staff' && m.tenantId === session.tenantId),
    [db.messages, session.tenantId],
  );
  useOnNew(staffMessages, (m) => {
    if (m.at >= mountedAt) push({ source: 'MAX · бот деканата', text: m.text, tone: 'light' });
  });

  if (!authed) return <PanelLogin framed={framed} onDone={() => setAuthed(true)} />;
  if (!loadedTenant || !db.tenants.length) {
    return (
      <div className={`pn ${framed ? 'pn--framed' : ''}`}>
        <aside className="pn-side"><div className="pn-side__title">Панель</div></aside>
        <section className="pn-main"><header className="pn-head"><div><h1>Загружаем…</h1></div></header></section>
      </div>
    );
  }

  const tenant = tenantById(db, session.tenantId) ?? db.tenants[0];
  const stats = tenantStats(db, tenant.id);
  const serverInfo = db as unknown as { bot?: { enabled: boolean; username: string }; staffCount?: number };

  const role = session.role;
  const nav =
    role === 'staff'
      ? [
          { id: 'queue', label: 'Очередь', active: staffView.name === 'queue', badge: stats.newCount, onClick: () => setStaffView({ name: 'queue' }) },
          {
            id: 'card', label: 'Заявка', active: staffView.name === 'card', disabled: lastCard == null,
            onClick: () => lastCard != null && openCard(lastCard),
          },
        ]
      : [
          { id: 'dash', label: 'Дашборд', active: adminView.name === 'dashboard', onClick: () => setAdminView({ name: 'dashboard' }) },
          {
            id: 'builder', label: 'Конструктор', active: adminView.name === 'builder',
            onClick: () => setAdminView({ name: 'builder', serviceId: adminView.name === 'builder' ? adminView.serviceId : null }),
          },
        ];

  return (
    <div className={`pn ${framed ? 'pn--framed' : ''}`}>
      <aside className="pn-side">
        <div className="pn-side__brand">
          <div className="pn-side__title">{role === 'staff' ? 'Панель' : 'Админ вуза'}</div>
          <div className="pn-side__sub">{role === 'staff' ? `Деканат · ${tenant.short}` : `Веб-приложение · ${tenant.short}`}</div>
          <div className="pn-testdata" title="Вузы, студенты и заявки вымышленные; интеграций с системами вуза нет">Тестовые данные</div>
        </div>
        <nav className="pn-nav" aria-label="Разделы панели">
          {nav.map((n) => (
            <button key={n.id} className={`pn-nav__item ${n.active ? 'is-active' : ''}`} disabled={'disabled' in n && n.disabled} onClick={n.onClick}>
              <span>{n.label}</span>
              {'badge' in n && n.badge ? <span className="pn-nav__badge tnum">{n.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="pn-side__foot">
          <label className="pn-side__label" htmlFor="pn-tenant">Вуз</label>
          <select id="pn-tenant" className="pn-side__select" value={session.tenantId}
            onChange={(e) => {
              setSession({ ...session, tenantId: e.target.value });
              setStaffView({ name: 'queue' });
              setLastCard(null);
              setAdminView({ name: 'dashboard' });
            }}>
            {db.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="pn-role" role="radiogroup" aria-label="Роль">
            <button role="radio" aria-checked={role === 'staff'} className={role === 'staff' ? 'is-active' : ''}
              onClick={() => setSession({ ...session, role: 'staff' })}>
              Сотрудник деканата
              <small>Разбирает заявки</small>
            </button>
            <button role="radio" aria-checked={role === 'admin'} className={role === 'admin' ? 'is-active' : ''}
              onClick={() => setSession({ ...session, role: 'admin' })}>
              Администратор
              <small>Услуги без разработчика</small>
            </button>
          </div>
          {BACKEND && (
            <div className="pn-server">
              <span className={`pn-server__dot ${serverInfo.bot?.enabled ? 'is-on' : ''}`} />
              {serverInfo.bot?.enabled ? `Бот @${serverInfo.bot.username || '—'} подключён` : 'Бот не подключён'}
              <small>Сотрудников в MAX: {serverInfo.staffCount ?? 0} · команда боту «/staff КОД»</small>
            </div>
          )}
        </div>
      </aside>

      <section className="pn-main">
        {role === 'staff' && staffView.name === 'queue' && <Queue db={db} tenantId={session.tenantId} onOpen={openCard} />}
        {role === 'staff' && staffView.name === 'card' && (
          <RequestCard db={db} requestId={staffView.requestId} onBack={() => setStaffView({ name: 'queue' })} />
        )}
        {role === 'admin' && adminView.name === 'dashboard' && (
          <Dashboard db={db} tenantId={session.tenantId} stats={stats}
            onNew={() => setAdminView({ name: 'builder', serviceId: null })}
            onEdit={(id) => setAdminView({ name: 'builder', serviceId: id })} />
        )}
        {role === 'admin' && adminView.name === 'builder' && (
          <Builder
            key={adminView.serviceId ?? 'new'}
            db={db} tenantId={session.tenantId} serviceId={adminView.serviceId}
            onDone={(msg) => { push({ source: 'Конструктор', text: msg, tone: 'light' }); setAdminView({ name: 'dashboard' }); }}
          />
        )}
      </section>
      <Toasts toasts={toasts} badge="Д" />
    </div>
  );
}

/** Вход в панель (режим с сервером). Пароль — PANEL_PASSWORD из .env. */
function PanelLogin({ framed, onDone }: { framed: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await http<{ token: string }>('POST', '/api/panel/login', { password });
      setToken('panel', r.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`pn ${framed ? 'pn--framed' : ''}`}>
      <aside className="pn-side">
        <div className="pn-side__title">Панель</div>
        <div className="pn-side__sub">UniFlow · вуз</div>
      </aside>
      <section className="pn-main">
        <header className="pn-head"><div><h1>Вход в панель</h1><p>Для сотрудников деканата и администратора вуза</p></div></header>
        <div className="pn-body">
          <form className="pn-login" onSubmit={submit}>
            <label className="pn-input">
              <span>Пароль панели</span>
              <input id="pn-password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            {error && <div className="pn-error">{error}</div>}
            <div><button className="btn btn--primary" type="submit" disabled={busy || !password}>{busy ? 'Входим…' : 'Войти'}</button></div>
          </form>
        </div>
      </section>
    </div>
  );
}
