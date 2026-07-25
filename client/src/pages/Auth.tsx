import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../api';
import type { AuthStatus } from '../types';
import { Field, Input } from '../components/ui';

export default function Auth({ needsSetup, onAuthed }: { needsSetup: boolean; onAuthed: (a: AuthStatus) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState('');

  useEffect(() => {
    api.getVersion().then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = needsSetup ? await api.register(username.trim(), password) : await api.login(username.trim(), password);
      onAuthed(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-2xl font-bold text-white shadow-lg shadow-violet-900/40">S</div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">Seenr Bridge</div>
            <div className="mt-0.5 text-sm text-slate-400">{needsSetup ? 'Create your account to get started' : 'Sign in to continue'}</div>
          </div>
        </div>
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </Field>
          <Field label="Password" hint={needsSetup ? 'At least 8 characters' : undefined}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} />
          </Field>
          {err && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</div>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Please wait…' : needsSetup ? 'Create account' : 'Log in'}
          </button>
        </div>
        {version && <div className="mt-5 text-center text-[11px] text-slate-600">Seenr Bridge · v{version}</div>}
      </form>
    </div>
  );
}
