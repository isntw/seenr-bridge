import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { LibraryItem, SharedTitle, Mapping, BackfillResult } from '../types';
import { Button, Badge } from '../components/ui';

type MediaType = 'show' | 'movie';

function poster(path: string | null | undefined) {
  return path ? `/api/image?path=${encodeURIComponent(path)}` : null;
}

export default function Shared() {
  const [type, setType] = useState<MediaType>('show');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // debounced/applied search
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [libError, setLibError] = useState<string | null>(null);
  const [sharedOnly, setSharedOnly] = useState(false);

  const [shared, setShared] = useState<SharedTitle[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({}); // shows: "only new ones" chosen

  const sharedMap = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of shared) m.set(s.rating_key, s.profiles);
    return m;
  }, [shared]);

  useEffect(() => {
    api.getShared().then(setShared).catch(() => setShared([]));
    api.getMappings().then(setMappings).catch(() => setMappings([]));
  }, []);

  const load = (t: MediaType, q: string, start: number) => {
    setLoading(true);
    setLibError(null);
    api
      .getLibrary(t, q, start, 50)
      .then((r) => {
        if (!r.ok) setLibError(r.error || 'Could not load library from Tautulli.');
        setItems((prev) => (start === 0 ? r.items : [...prev, ...r.items]));
        setTotal(r.total);
      })
      .catch((e) => setLibError(e.message))
      .finally(() => setLoading(false));
  };

  // (re)load list when type or applied query changes, unless we're in shared-only view
  useEffect(() => {
    if (sharedOnly) return;
    load(type, query, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, query, sharedOnly]);

  const applySearch = () => setQuery(search.trim());

  const toggleProfile = async (item: { rating_key: string; media_type: string; title?: string | null; year?: string | null; image?: string | null }, mappingId: number) => {
    const cur = sharedMap.get(item.rating_key) || [];
    const next = cur.includes(mappingId) ? cur.filter((id) => id !== mappingId) : [...cur, mappingId];
    // optimistic
    setShared((prev) => {
      const others = prev.filter((s) => s.rating_key !== item.rating_key);
      if (next.length === 0) return others;
      const existing = prev.find((s) => s.rating_key === item.rating_key);
      return [
        ...others,
        {
          rating_key: item.rating_key,
          media_type: item.media_type,
          title: item.title ?? existing?.title ?? null,
          year: item.year ?? existing?.year ?? null,
          image: item.image ?? existing?.image ?? null,
          profiles: next,
        },
      ];
    });
    try {
      await api.setShared({
        rating_key: item.rating_key,
        media_type: item.media_type,
        title: item.title ?? undefined,
        year: item.year ?? undefined,
        image: item.image ?? undefined,
        profiles: next,
      });
    } catch {
      api.getShared().then(setShared).catch(() => {});
    }
  };

  const backfill = async (rating_key: string) => {
    setBusyKey(rating_key);
    setResult((r) => ({ ...r, [rating_key]: undefined as any }));
    try {
      const r: BackfillResult = await api.backfillShared(rating_key);
      let msg: string;
      if (!r.ok && r.reason) msg = r.reason;
      else if (r.media_type === 'movie') msg = `marked watched for ${r.profiles} profile${r.profiles === 1 ? '' : 's'} (${r.ok_count} ok${r.fail_count ? `, ${r.fail_count} failed` : ''})`;
      else msg = `${r.items} episode${r.items === 1 ? '' : 's'} → ${r.profiles} profile${r.profiles === 1 ? '' : 's'} · ${r.ok_count} ok${r.fail_count ? `, ${r.fail_count} failed` : ''}`;
      setResult((res) => ({ ...res, [rating_key]: { ok: r.ok, msg } }));
    } catch (e: any) {
      setResult((res) => ({ ...res, [rating_key]: { ok: false, msg: e.message } }));
    } finally {
      setBusyKey(null);
    }
  };

  const initials = (name: string) => name.slice(0, 2).toUpperCase();

  // Rows to render: the library page, or (shared-only) the stored shared titles.
  const rows: { rating_key: string; media_type: string; title: string | null; year: string | null; image: string | null }[] = sharedOnly
    ? shared.map((s) => ({ rating_key: s.rating_key, media_type: s.media_type, title: s.title, year: s.year, image: s.image }))
    : items.map((i) => ({ rating_key: i.rating_key, media_type: i.media_type, title: i.title, year: i.year, image: i.image }));

  if (mappings.length === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-center text-sm text-slate-400">
          Add at least one user under <span className="text-slate-200">Settings → Map users</span> first. Co-watching needs profiles to share to.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header count={shared.length} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5">
          {(['show', 'movie'] as MediaType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              disabled={sharedOnly}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${type === t ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {t === 'show' ? 'TV Shows' : 'Movies'}
            </button>
          ))}
        </div>

        {!sharedOnly && (
          <div className="flex flex-1 items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder={`Search ${type === 'show' ? 'shows' : 'movies'}…`}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500/60"
            />
            <Button variant="ghost" onClick={applySearch}>Search</Button>
          </div>
        )}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={sharedOnly} onChange={(e) => setSharedOnly(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Shared only
        </label>
      </div>

      {libError && !sharedOnly && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{libError}</div>}

      <div className="space-y-2">
        {rows.length === 0 && !loading && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-center text-sm text-slate-500">
            {sharedOnly ? 'Nothing shared yet. Turn off “Shared only” and pick titles to co-watch.' : 'No titles found.'}
          </div>
        )}

        {rows.map((item) => {
          const profiles = sharedMap.get(item.rating_key) || [];
          const isShared = profiles.length > 0;
          const isShow = item.media_type === 'show';
          const res = result[item.rating_key];
          return (
            <div key={item.rating_key} className={`rounded-xl border px-3 py-3 transition ${isShared ? 'border-violet-500/30 bg-violet-500/[0.06]' : 'border-white/10 bg-black/20'}`}>
              <div className="flex gap-3">
                <div className="h-[72px] w-12 shrink-0 overflow-hidden rounded-md bg-black/40">
                  {poster(item.image) ? <img src={poster(item.image)!} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{item.title}</span>
                    {item.year && <span className="text-xs text-slate-500">{item.year}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${isShow ? 'bg-violet-500/15 text-violet-300 ring-violet-500/30' : 'bg-sky-500/15 text-sky-300 ring-sky-500/30'}`}>
                      {isShow ? 'show' : 'movie'}
                    </span>
                  </div>

                  {/* profile chips */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {mappings.map((m) => {
                      const on = profiles.includes(m.id);
                      return (
                        <button
                          key={m.id}
                          onClick={() => toggleProfile(item, m.id)}
                          title={m.username}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-400 ring-1 ring-inset ring-white/10 hover:text-white'}`}
                        >
                          <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${on ? 'bg-white/20' : 'bg-white/10'}`}>{initials(m.username)}</span>
                          {m.username}
                        </button>
                      );
                    })}
                  </div>

                  {/* retroactive actions when shared */}
                  {isShared && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {isShow ? (
                        dismissed[item.rating_key] ? (
                          <span className="text-xs text-slate-500">Only new watches will sync. <button onClick={() => setDismissed((d) => ({ ...d, [item.rating_key]: false }))} className="text-violet-400 hover:text-violet-300">change</button></span>
                        ) : (
                          <>
                            <Button variant="ghost" onClick={() => backfill(item.rating_key)} disabled={busyKey === item.rating_key}>
                              {busyKey === item.rating_key ? 'Syncing…' : 'Sync all previous episodes'}
                            </Button>
                            <Button variant="ghost" onClick={() => setDismissed((d) => ({ ...d, [item.rating_key]: true }))}>Only new ones</Button>
                          </>
                        )
                      ) : (
                        <Button variant="ghost" onClick={() => backfill(item.rating_key)} disabled={busyKey === item.rating_key}>
                          {busyKey === item.rating_key ? 'Syncing…' : 'Sync now'}
                        </Button>
                      )}
                      {res && <Badge tone={res.ok ? 'green' : 'red'}>{res.msg}</Badge>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!sharedOnly && items.length < total && (
        <div className="pt-1 text-center">
          <Button variant="ghost" onClick={() => load(type, query, items.length)} disabled={loading}>
            {loading ? 'Loading…' : `Load more (${items.length}/${total})`}
          </Button>
        </div>
      )}
      {loading && items.length === 0 && <div className="py-6 text-center text-sm text-slate-500">Loading library…</div>}
    </div>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-white">Shared / co-watched</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Pick titles you watch together. A watch from any assigned profile scrobbles to all of them.
        </p>
      </div>
      {count !== undefined && count > 0 && <Badge tone="violet">{count} shared</Badge>}
    </div>
  );
}
