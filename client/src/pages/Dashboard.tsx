import { useEffect, useState, useCallback, Fragment } from 'react';
import { api } from '../api';
import type { EventRow, Stats } from '../types';
import { Card, StatCard, Badge, Button } from '../components/ui';

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

function EventStatus({ e }: { e: EventRow }) {
  if (e.ok) return <Badge tone="green">checked in</Badge>;
  if (e.seenr_status) return <Badge tone="red">seenr {e.seenr_status}</Badge>;
  return <Badge tone="amber">failed</Badge>;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.getStats(), api.getEvents(100)]);
      setStats(s);
      setEvents(e);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const rate = stats && stats.total ? Math.round((stats.ok / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total events" value={stats?.total ?? '—'} />
        <StatCard label="Checked in" value={stats?.ok ?? '—'} accent="text-emerald-400" />
        <StatCard label="Failed" value={stats?.failed ?? '—'} accent={stats?.failed ? 'text-rose-400' : 'text-white'} />
        <StatCard label="Success rate" value={stats ? `${rate}%` : '—'} accent="text-violet-300" />
      </div>

      <Card
        title="Recent scrobbles"
        subtitle="Live — refreshes every 5s"
        actions={<Button variant="ghost" onClick={load}>Refresh</Button>}
      >
        {err && <div className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</div>}
        {events.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No events yet. Point a Tautulli webhook at <code className="text-slate-300">/api/webhook/tautulli</code> and play something.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="pb-2 pr-3 font-medium">When</th>
                  <th className="pb-2 pr-3 font-medium">User</th>
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="pb-2 pr-3 font-medium">Event</th>
                  <th className="pb-2 pr-3 font-medium">Matched by</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {events.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer align-top hover:bg-white/[0.02]" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-slate-400">{timeAgo(e.ts)}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-slate-200">{e.username || '—'}</td>
                      <td className="py-2.5 pr-3 text-white">
                        {e.title || '—'}
                        {e.media_type && <span className="ml-2 text-xs text-slate-500">{e.media_type}</span>}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap"><Badge tone="violet">{(e.event || '').replace('media.', '')}</Badge></td>
                      <td className="py-2.5 pr-3 whitespace-nowrap font-mono text-xs text-slate-400">
                        {e.ids && e.ids.length ? e.ids.find((i) => i.startsWith('tmdb://')) || e.ids[0] : <span className="text-slate-600">no ext id</span>}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap"><EventStatus e={e} /></td>
                    </tr>
                    {open === e.id && (
                      <tr className="bg-black/30">
                        <td colSpan={6} className="px-3 py-3">
                          {e.error && <div className="mb-2 rounded bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{e.error}</div>}
                          <div className="mb-1 text-xs text-slate-500">
                            rating_key {e.rating_key} · ids: {e.ids?.join(', ') || 'none'}
                          </div>
                          <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-slate-300">
{e.payload ? JSON.stringify(JSON.parse(e.payload), null, 2) : '(no payload)'}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
