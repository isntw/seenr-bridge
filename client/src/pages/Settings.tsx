import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Settings as TSettings, Mapping, TestResult, SyncResult, Status } from '../types';
import { Button, Field, Input, Toggle, Badge, CopyField, Modal } from '../components/ui';

function syncSummary(m: { sync_episodes: boolean; sync_movies: boolean }): string {
  if (m.sync_episodes && m.sync_movies) return 'TV + Movies';
  if (m.sync_episodes) return 'TV only';
  if (m.sync_movies) return 'Movies only';
  return 'nothing';
}

const TRIGGERS = [
  { key: 'watched', label: 'Watched', recommended: true },
  { key: 'play', label: 'Play' },
  { key: 'stop', label: 'Stop' },
  { key: 'pause', label: 'Pause' },
  { key: 'resume', label: 'Resume' },
];

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-600 text-xs font-semibold text-white">{n}</span>
        <span className="text-sm font-semibold text-white">{title}</span>
        {hint && <span className="ml-auto hidden text-xs text-slate-500 sm:block">{hint}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Collapsible({ open, onToggle, title, hint, children }: { open: boolean; onToggle: () => void; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <button onClick={onToggle} className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left">
        <svg className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        <span className="text-sm font-semibold text-white">{title}</span>
        {hint && <span className="ml-auto hidden text-xs text-slate-500 sm:block">{hint}</span>}
      </button>
      {open && <div className="border-t border-white/10 p-5">{children}</div>}
    </div>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${ok === null ? 'bg-slate-500' : ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />;
}

export default function Settings() {
  const [s, setS] = useState<TSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [newUser, setNewUser] = useState('');
  const [newToken, setNewToken] = useState('');
  const [edit, setEdit] = useState<Mapping | null>(null);

  const [testRk, setTestRk] = useState('');
  const [testUser, setTestUser] = useState('');
  const [testAction, setTestAction] = useState('watched');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [triggers, setTriggers] = useState<Record<string, boolean>>({ watched: true, play: false, stop: false, pause: false, resume: false });

  const [showManual, setShowManual] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTest, setShowTest] = useState(false);

  const refreshStatus = () => api.getStatus().then(setStatus).catch(() => setStatus(null));

  useEffect(() => {
    api.getSettings().then(setS);
    api.getMappings().then(setMappings);
    refreshStatus();
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      setS(await api.saveSettings(s));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      refreshStatus();
    } finally {
      setSaving(false);
    }
  };

  // instant-apply for toggles
  const patch = async (p: Partial<TSettings>) => {
    if (!s) return;
    const next = { ...s, ...p };
    setS(next);
    await api.saveSettings(next);
  };

  const testConn = async () => {
    if (!s) return;
    setTestMsg(null);
    setTestMsg(await api.testTautulli({ tautulli_url: s.tautulli_url, tautulli_apikey: s.tautulli_apikey }));
    refreshStatus();
  };

  const addMapping = async () => {
    if (!newUser.trim() || !newToken.trim()) return;
    await api.saveMapping({ username: newUser.trim(), seenr_token: newToken.trim(), enabled: true });
    setNewUser('');
    setNewToken('');
    setMappings(await api.getMappings());
    refreshStatus();
  };
  const delMapping = async (id: number) => {
    await api.deleteMapping(id);
    setMappings(await api.getMappings());
    refreshStatus();
  };
  const saveEdit = async () => {
    if (!edit) return;
    await api.saveMapping({
      username: edit.username,
      seenr_token: edit.seenr_token.trim(),
      enabled: edit.enabled,
      sync_movies: edit.sync_movies,
      sync_episodes: edit.sync_episodes,
    });
    setEdit(null);
    setMappings(await api.getMappings());
    refreshStatus();
  };

  const runTest = async (dryRun: boolean) => {
    if (!testRk.trim() || !testUser.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      setTestResult(await api.test({ rating_key: testRk.trim(), username: testUser.trim(), action: testAction, dryRun }));
    } catch (e: any) {
      setTestResult({ ok: false, reason: e.message });
    } finally {
      setTestBusy(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      setSyncResult(await api.syncWebhook(Object.keys(triggers).filter((k) => triggers[k])));
      refreshStatus();
    } catch (e: any) {
      setSyncResult({ ok: false, error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  if (!s) return <div className="text-slate-400">Loading…</div>;

  const webhookUrl = `${(s.bridge_url || window.location.origin).replace(/\/+$/, '')}/api/webhook/tautulli`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-white">Setup</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5"><Dot ok={status ? status.tautulli.ok : null} /><span className="text-slate-400">{status ? (status.tautulli.ok ? 'Tautulli connected' : 'Tautulli offline') : 'checking…'}</span></span>
          <span className="text-slate-500">{status?.users ?? '—'} {status?.users === 1 ? 'user' : 'users'}</span>
          <span className="flex items-center gap-1.5"><Dot ok={status ? status.webhook : null} /><span className="text-slate-400">{status ? (status.webhook ? 'webhook active' : 'no webhook') : ''}</span></span>
        </div>
      </div>

      <Step n={1} title="Connect Tautulli" hint="where the bridge reads episode IDs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tautulli URL" hint="e.g. http://tautulli:8181">
            <Input value={s.tautulli_url} onChange={(e) => setS({ ...s, tautulli_url: e.target.value })} placeholder="http://tautulli:8181" />
          </Field>
          <Field label="API key" hint="Tautulli → Settings → Web Interface → API key">
            <Input value={s.tautulli_apikey} onChange={(e) => setS({ ...s, tautulli_apikey: e.target.value })} placeholder="xxxxxxxx" type="password" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={testConn}>Test connection</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {saved && <Badge tone="green">saved</Badge>}
          {testMsg && <Badge tone={testMsg.ok ? 'green' : 'red'}>{testMsg.message}</Badge>}
        </div>
      </Step>

      <Step n={2} title="Map users to seenr" hint="each Plex user → their seenr token">
        <div className="space-y-2">
          {mappings.length === 0 && <div className="py-1 text-sm text-slate-500">No users yet. Add one below.</div>}
          {mappings.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <span className="truncate">{m.username}</span>
                  {!m.enabled && <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-inset ring-slate-500/30">paused</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{m.seenr_token.slice(0, 8)}…{m.seenr_token.slice(-6)}</span>
                  <span>·</span>
                  <span>{syncSummary(m)}</span>
                </div>
              </div>
              <Button variant="ghost" onClick={() => setEdit({ ...m })}>Configure</Button>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
          <Field label="Plex username"><Input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="plexuser" /></Field>
          <Field label="seenr token" hint="the part after /scrobble/plex/ in your seenr URL">
            <Input value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder="9%7CyourSeenrToken" />
          </Field>
          <div>
            <div className="mb-1.5 select-none text-sm" aria-hidden>&nbsp;</div>
            <Button onClick={addMapping}>Add</Button>
          </div>
        </div>
      </Step>

      <Step n={3} title="Send Tautulli's events here" hint="one webhook, covers every user">
        <div className="mb-4">
          <div className="mb-2.5 text-sm font-medium text-slate-200">Triggers to enable</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">
            {TRIGGERS.map((t) => (
              <label key={t.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={!!triggers[t.key]} onChange={() => setTriggers((p) => ({ ...p, [t.key]: !p[t.key] }))} className="h-4 w-4 accent-violet-500" />
                {t.label}
                {t.recommended && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30">recommended</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runSync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync to Tautulli'}</Button>
          {syncResult && (
            <Badge tone={syncResult.ok ? 'green' : 'red'}>
              {syncResult.ok ? `${syncResult.created ? 'created' : 'updated'} webhook #${syncResult.notifier_id}` : syncResult.error || 'sync failed'}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">Creates or updates a “Seenr Bridge” webhook notifier in Tautulli with the triggers you pick. Watched is what marks items as watched in seenr.</p>

        <div className="mt-4">
          <Collapsible open={showManual} onToggle={() => setShowManual(!showManual)} title="Set it up manually instead">
            <div className="space-y-4">
              <CopyField label="Webhook URL   ·   Method: POST" value={webhookUrl} hint="Must be reachable from your Tautulli host/container." />
              <CopyField label="JSON Headers" value={'{"Content-Type": "application/json"}'} />
              <CopyField label="JSON Data   (paste into each trigger you enable)" value={'{"action": "{action}", "rating_key": "{rating_key}", "username": "{username}"}'} />
            </div>
          </Collapsible>
        </div>
      </Step>

      <Collapsible open={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} title="Advanced" hint="forwarding · seenr URL · bridge URL">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Toggle checked={s.forward_enabled} onChange={(v) => patch({ forward_enabled: v })} />
            <span className="text-sm text-slate-300">Forward to seenr{!s.forward_enabled && ' — paused'} <span className="text-slate-500">· master switch for all users</span></span>
          </div>

          <div className="grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-2 sm:items-start">
            <Field label="seenr base URL" hint="token is appended per user; default is correct for seenr.app">
              <Input value={s.seenr_base_url} onChange={(e) => setS({ ...s, seenr_base_url: e.target.value })} />
            </Field>
            <Field label="Bridge public URL (optional)" hint="the URL Tautulli uses to reach the bridge; blank = auto-detect">
              <Input value={s.bridge_url} onChange={(e) => setS({ ...s, bridge_url: e.target.value })} placeholder="http://192.168.1.10:8687" />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            {saved && <Badge tone="green">saved</Badge>}
          </div>
        </div>
      </Collapsible>

      <Collapsible open={showTest} onToggle={() => setShowTest(!showTest)} title="Test a scrobble" hint="send a rating_key through the pipeline">
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field label="rating_key"><Input value={testRk} onChange={(e) => setTestRk(e.target.value)} placeholder="25419" /></Field>
          <Field label="username"><Input value={testUser} onChange={(e) => setTestUser(e.target.value)} placeholder="plexuser" /></Field>
          <Field label="action">
            <select value={testAction} onChange={(e) => setTestAction(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/60">
              {['watched', 'play', 'pause', 'resume', 'stop'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => runTest(true)} disabled={testBusy}>Preview payload</Button>
          <Button onClick={() => runTest(false)} disabled={testBusy}>Send to seenr</Button>
          {testResult && (
            <Badge tone={testResult.ok ? 'green' : testResult.skipped ? 'amber' : 'red'}>
              {testResult.ok ? (testResult.seenr_status ? `sent · seenr ${testResult.seenr_status}` : 'payload built') : testResult.reason || 'failed'}
            </Badge>
          )}
        </div>
        {testResult?.payload && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-slate-300">
{JSON.stringify(testResult.payload, null, 2)}
          </pre>
        )}
      </Collapsible>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Configure ${edit.username}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-4">
            <Field label="seenr token" hint="the part after /scrobble/plex/ in this user's seenr URL">
              <Input value={edit.seenr_token} onChange={(e) => setEdit({ ...edit, seenr_token: e.target.value })} />
            </Field>
            <label className="flex items-center gap-3">
              <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} />
              <span className="text-sm text-slate-300">Active{!edit.enabled && ' — paused'}</span>
            </label>
            <div className="border-t border-white/10 pt-4">
              <div className="mb-2.5 text-sm font-medium text-slate-200">What to sync</div>
              <div className="flex flex-col gap-2.5">
                <label className="flex items-center gap-3"><Toggle checked={edit.sync_episodes} onChange={(v) => setEdit({ ...edit, sync_episodes: v })} /><span className="text-sm text-slate-300">TV episodes</span></label>
                <label className="flex items-center gap-3"><Toggle checked={edit.sync_movies} onChange={(v) => setEdit({ ...edit, sync_movies: v })} /><span className="text-sm text-slate-300">Movies</span></label>
              </div>
            </div>
            <button onClick={() => { delMapping(edit.id); setEdit(null); }} className="text-xs text-rose-400 transition hover:text-rose-300">Remove this user</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
