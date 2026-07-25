import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Settings as TSettings, Mapping, TestResult } from '../types';
import { Card, Button, Field, Input, Toggle, Badge } from '../components/ui';

export default function Settings() {
  const [s, setS] = useState<TSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [newUser, setNewUser] = useState('');
  const [newToken, setNewToken] = useState('');

  const [testRk, setTestRk] = useState('');
  const [testUser, setTestUser] = useState('');
  const [testAction, setTestAction] = useState('watched');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const load = async () => {
    setS(await api.getSettings());
    setMappings(await api.getMappings());
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true); setSaved(false);
    try {
      const next = await api.saveSettings(s);
      setS(next); setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const testConn = async () => {
    if (!s) return;
    setTestMsg(null);
    setTestMsg(await api.testTautulli({ tautulli_url: s.tautulli_url, tautulli_apikey: s.tautulli_apikey }));
  };

  const addMapping = async () => {
    if (!newUser.trim() || !newToken.trim()) return;
    await api.saveMapping({ username: newUser.trim(), seenr_token: newToken.trim(), enabled: true });
    setNewUser(''); setNewToken('');
    setMappings(await api.getMappings());
  };

  const toggleMapping = async (m: Mapping) => {
    await api.saveMapping({ username: m.username, seenr_token: m.seenr_token, enabled: !m.enabled });
    setMappings(await api.getMappings());
  };

  const delMapping = async (id: number) => {
    await api.deleteMapping(id);
    setMappings(await api.getMappings());
  };

  const runTest = async (dryRun: boolean) => {
    if (!testRk.trim() || !testUser.trim()) return;
    setTestBusy(true); setTestResult(null);
    try {
      setTestResult(await api.test({ rating_key: testRk.trim(), username: testUser.trim(), action: testAction, dryRun }));
    } catch (e: any) {
      setTestResult({ ok: false, reason: e.message });
    } finally { setTestBusy(false); }
  };

  if (!s) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <Card title="Connection" subtitle="How the bridge reaches Tautulli and seenr"
        actions={<div className="flex items-center gap-2">{saved && <Badge tone="green">saved</Badge>}<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div>}>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          <Field label="Tautulli URL" hint="e.g. http://tautulli:8181 or http://192.168.1.10:30047">
            <Input value={s.tautulli_url} onChange={(e) => setS({ ...s, tautulli_url: e.target.value })} placeholder="http://tautulli:8181" />
          </Field>
          <Field label="Tautulli API key" hint="Tautulli → Settings → Web Interface → API key">
            <Input value={s.tautulli_apikey} onChange={(e) => setS({ ...s, tautulli_apikey: e.target.value })} placeholder="xxxxxxxx" type="password" />
          </Field>
          <Field label="seenr base URL" hint="Token is appended per user. Default is correct for seenr.app.">
            <Input value={s.seenr_base_url} onChange={(e) => setS({ ...s, seenr_base_url: e.target.value })} />
          </Field>
          <div>
            <div className="mb-1.5 select-none text-sm" aria-hidden>&nbsp;</div>
            <div className="flex h-[38px] items-center gap-3">
              <Toggle checked={s.forward_enabled} onChange={(v) => setS({ ...s, forward_enabled: v })} />
              <span className="text-sm text-slate-300">Forward to seenr{!s.forward_enabled && ' (paused)'}</span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="ghost" onClick={testConn}>Test Tautulli connection</Button>
          {testMsg && <Badge tone={testMsg.ok ? 'green' : 'red'}>{testMsg.message}</Badge>}
        </div>
      </Card>

      <Card title="User → seenr mappings" subtitle="Each Plex username routes to that user's seenr token">
        <div className="space-y-2">
          {mappings.length === 0 && <div className="py-2 text-sm text-slate-500">No mappings yet. Add one below.</div>}
          {mappings.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="w-40 truncate text-sm font-medium text-white">{m.username}</div>
              <div className="flex-1 truncate font-mono text-xs text-slate-400">{m.seenr_token.slice(0, 10)}…{m.seenr_token.slice(-6)}</div>
              <Toggle checked={m.enabled} onChange={() => toggleMapping(m)} />
              <Button variant="danger" onClick={() => delMapping(m.id)}>Delete</Button>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
          <Field label="Plex username"><Input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="plexuser" /></Field>
          <Field label="seenr token" hint="The part after /scrobble/plex/ in your seenr webhook URL">
            <Input value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder="9%7CyourSeenrToken" />
          </Field>
          <div>
            <div className="mb-1.5 select-none text-sm" aria-hidden>&nbsp;</div>
            <Button onClick={addMapping}>Add</Button>
          </div>
        </div>
      </Card>

      <Card title="Test a scrobble" subtitle="Build the payload for a rating_key (Preview) or actually send it to seenr">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-end">
          <Field label="rating_key"><Input value={testRk} onChange={(e) => setTestRk(e.target.value)} placeholder="25419" /></Field>
          <Field label="username"><Input value={testUser} onChange={(e) => setTestUser(e.target.value)} placeholder="plexuser" /></Field>
          <Field label="action">
            <select value={testAction} onChange={(e) => setTestAction(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/60">
              {['watched', 'play', 'pause', 'resume', 'stop'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="ghost" onClick={() => runTest(true)} disabled={testBusy}>Preview payload</Button>
          <Button onClick={() => runTest(false)} disabled={testBusy}>Send to seenr</Button>
          {testResult && (
            <Badge tone={testResult.ok ? 'green' : testResult.skipped ? 'amber' : 'red'}>
              {testResult.ok ? (testResult.seenr_status ? `sent · seenr ${testResult.seenr_status}` : 'payload built') : testResult.reason || 'failed'}
            </Badge>
          )}
        </div>
        {testResult?.payload && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-slate-500">
              matched by ids: {testResult.ids?.length ? testResult.ids.join(', ') : 'none (title/guid fallback)'}
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-slate-300">
{JSON.stringify(testResult.payload, null, 2)}
            </pre>
          </div>
        )}
      </Card>
    </div>
  );
}
