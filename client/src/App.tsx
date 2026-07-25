import { useState, useEffect, useRef } from 'react';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Auth from './pages/Auth';
import { api } from './api';
import type { AuthStatus } from './types';
import { Modal, Field, Input, Button } from './components/ui';

type Tab = 'dashboard' | 'settings';

const sIcon = 'h-[18px] w-[18px]';
const IconDashboard = () => (<svg className={sIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></svg>);
const IconSettings = () => (<svg className={sIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>);

const NAV: { key: Tab; label: string; icon: () => JSX.Element }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { key: 'settings', label: 'Settings', icon: IconSettings },
];

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | 'loading'>('loading');

  useEffect(() => {
    api.authStatus().then(setAuth).catch(() => setAuth({ authenticated: false, username: null, needsSetup: false }));
  }, []);

  if (auth === 'loading') return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading…</div>;
  if (!auth.authenticated) return <Auth needsSetup={auth.needsSetup} onAuthed={setAuth} />;

  return <Shell username={auth.username} onLogout={() => setAuth({ authenticated: false, username: null, needsSetup: false })} />;
}

function AccountMenu({ username, onLogout }: { username: string | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [showPw, setShowPw] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [conf, setConf] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const closePw = () => {
    setShowPw(false);
    setCur(''); setNw(''); setConf(''); setPwErr(null); setPwDone(false);
  };
  const submitPw = async () => {
    setPwErr(null);
    if (nw !== conf) return setPwErr('New passwords do not match.');
    setPwBusy(true);
    try {
      await api.changePassword(cur, nw);
      setPwDone(true);
      setCur(''); setNw(''); setConf('');
      setTimeout(closePw, 1200);
    } catch (e: any) {
      setPwErr(e.message);
    } finally {
      setPwBusy(false);
    }
  };

  const initials = (username || '?').slice(0, 2).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 transition hover:bg-white/10">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">{initials}</span>
        <span className="hidden max-w-[140px] truncate text-sm text-slate-300 sm:block">{username}</span>
        <svg className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#0e1320] shadow-xl shadow-black/50">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-xs text-slate-500">Signed in as</div>
            <div className="truncate text-sm font-medium text-white">{username}</div>
          </div>
          <button onClick={() => { setOpen(false); setShowPw(true); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Change password
          </button>
          <button onClick={onLogout} className="flex w-full items-center gap-2.5 border-t border-white/10 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            Log out
          </button>
        </div>
      )}

      <Modal
        open={showPw}
        onClose={closePw}
        title="Change password"
        footer={
          <>
            <Button variant="ghost" onClick={closePw}>Cancel</Button>
            <Button onClick={submitPw} disabled={pwBusy}>{pwBusy ? 'Saving…' : 'Update password'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 8 characters"><Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><Input type="password" value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="new-password" /></Field>
          {pwErr && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{pwErr}</div>}
          {pwDone && <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">Password updated.</div>}
        </div>
      </Modal>
    </div>
  );
}

function Shell({ username, onLogout }: { username: string | null; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [taut, setTaut] = useState<{ ok: boolean; message: string } | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    api.getVersion().then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const check = () =>
      api.testTautulli().then((r) => alive && setTaut(r)).catch(() => alive && setTaut({ ok: false, message: 'unreachable' }));
    check();
    const id = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    onLogout();
  };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-white/10 bg-[#0b0f18]">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-lg font-bold text-white shadow-lg shadow-violet-900/40">S</div>
          <div className="text-sm font-semibold text-white">Seenr Bridge</div>
        </div>

        <nav className="mt-2 flex flex-col gap-1 px-3">
          {NAV.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-violet-500/15 text-white ring-1 ring-inset ring-violet-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={active ? 'text-violet-300' : ''}><item.icon /></span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto p-3">
          {version && <div className="mb-2.5 text-center text-[11px] text-slate-600">v{version}</div>}
          <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2.5" title={taut?.message || undefined}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${taut === null ? 'bg-slate-500' : taut.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <span className="truncate text-xs text-slate-400">{taut === null ? 'Checking Tautulli…' : taut.ok ? 'Tautulli connected' : 'Tautulli unreachable'}</span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#0a0e16]/80 px-6 py-3 backdrop-blur">
          <h1 className="text-base font-semibold capitalize text-white">{tab}</h1>
          <AccountMenu username={username} onLogout={logout} />
        </header>

        <main className="mx-auto w-full max-w-5xl px-6 py-8">{tab === 'dashboard' ? <Dashboard /> : <Settings />}</main>
      </div>
    </div>
  );
}
