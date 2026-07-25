import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { api } from '../api';
import type { EventRow, Stats } from '../types';
import { Card, Button } from '../components/ui';

const svg = 'h-[18px] w-[18px]';
const IconTotal = () => (<svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 7l9 5 9-5-9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>);
const IconSeries = () => (<svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="13" rx="2" /><path d="m7 4 5 3 5-3" /></svg>);
const IconMovies = () => (<svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M7 5v14M17 5v14M2.5 9.5H7M2.5 14.5H7M17 9.5h4.5M17 14.5h4.5" /></svg>);
const IconUsers = () => (<svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>);

function Tile({ icon, label, value, accent }: { icon: ReactNode; label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
      <div className="flex items-center gap-2 text-slate-400">
        <span className="text-slate-500">{icon}</span>
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className={`mt-2 text-3xl font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function derive(e: EventRow): { main: string; sub: string } {
  let main = e.title || 'Unknown';
  let sub = '';
  try {
    const m = e.payload ? (JSON.parse(e.payload) as any).Metadata : null;
    if (m) {
      if (e.media_type === 'episode') {
        main = m.grandparentTitle || e.title || 'Unknown';
        sub = `S${m.parentIndex || '?'}·E${m.index || '?'}${m.title ? '  ·  ' + m.title : ''}`;
      } else {
        main = m.title || e.title || 'Unknown';
        sub = String(m.year || '');
      }
    }
  } catch {
    /* ignore malformed payload */
  }
  return { main, sub };
}

function matchedBy(ids: string[]): string {
  if (!ids || !ids.length) return 'no ext id';
  const pick = ids.find((i) => i.startsWith('tmdb://')) || ids[0];
  return pick.replace('://', ' ');
}

function statusOf(e: EventRow): { label: string; pill: string; rail: string } {
  if (e.ok) return { label: 'checked in', pill: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', rail: 'bg-emerald-500' };
  if (e.seenr_status) return { label: `seenr ${e.seenr_status}`, pill: 'bg-rose-500/15 text-rose-300 ring-rose-500/30', rail: 'bg-rose-500' };
  return { label: 'failed', pill: 'bg-amber-500/15 text-amber-300 ring-amber-500/30', rail: 'bg-amber-500' };
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.getStats(), api.getEvents(limit)]);
      setStats(s);
      setEvents(e);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [limit]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile icon={<IconTotal />} label="Total" value={stats?.total ?? '—'} />
        <Tile icon={<IconSeries />} label="Episodes" value={stats?.episodes ?? '—'} accent="text-violet-300" />
        <Tile icon={<IconMovies />} label="Movies" value={stats?.movies ?? '—'} accent="text-sky-300" />
        <Tile icon={<IconUsers />} label="Users" value={stats?.users ?? '—'} accent="text-emerald-300" />
      </div>

      <Card
        title="Recent scrobbles"
        subtitle="Live — refreshes every 5s"
        actions={<Button variant="ghost" onClick={load}>Refresh</Button>}
      >
        {err && <div className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</div>}
        {events.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No scrobbles yet. Point a Tautulli webhook at <code className="text-slate-300">/api/webhook/tautulli</code> and play something.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((e) => {
              const { main, sub } = derive(e);
              const st = statusOf(e);
              const isOpen = open === e.id;
              return (
                <div key={e.id}>
                  <div
                    onClick={() => setOpen(isOpen ? null : e.id)}
                    className="group relative flex cursor-pointer items-center gap-3.5 py-3 pl-4 pr-2 transition hover:bg-white/[0.03]"
                  >
                    <span className={`absolute inset-y-2.5 left-0 w-[3px] rounded-full ${st.rail}`} />
                    {e.image ? (
                      <img
                        src={`/api/image?path=${encodeURIComponent(e.image)}`}
                        alt=""
                        loading="lazy"
                        className="h-16 w-11 shrink-0 rounded-md object-cover ring-1 ring-inset ring-white/15"
                      />
                    ) : (
                      <div className="grid h-16 w-11 shrink-0 place-items-center rounded-md bg-white/5 text-xs text-slate-600 ring-1 ring-inset ring-white/15">?</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[15px] font-semibold tracking-tight text-white">{main}</h3>
                        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${e.media_type === 'movie' ? 'bg-sky-500/15 text-sky-300 ring-sky-500/30' : 'bg-violet-500/15 text-violet-300 ring-violet-500/30'}`}>{e.media_type}</span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-slate-400">{sub}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-xs text-slate-500">{e.username}</span>
                        <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-400 ring-1 ring-inset ring-white/10">{matchedBy(e.ids)}</code>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 pr-1">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${st.pill}`}>{st.label}</span>
                      <span className="text-xs text-slate-500">{timeAgo(e.ts)}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="bg-black/30 px-4 pb-4">
                      {e.error && <div className="mb-2 mt-3 rounded bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{e.error}</div>}
                      <div className="mb-1 pt-3 text-xs text-slate-500">
                        rating_key {e.rating_key} · event {e.event} · ids: {e.ids?.join(', ') || 'none'}
                      </div>
                      <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-slate-300">
{e.payload ? JSON.stringify(JSON.parse(e.payload), null, 2) : '(no payload)'}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {stats && events.length < stats.total && (
          <div className="pt-4 text-center">
            <Button variant="ghost" onClick={() => setLimit((l) => l + 25)}>
              Load more <span className="ml-1 text-slate-500">· {stats.total - events.length} older</span>
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
