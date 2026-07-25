import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';

type Tab = 'dashboard' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0a0e16]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-lg font-bold text-white shadow-lg shadow-violet-900/40">
              S
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Seenr Bridge</div>
              <div className="text-[11px] text-slate-400">Tautulli → episode-ID enrichment → seenr</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
            {(['dashboard', 'settings'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-medium capitalize transition ${
                  tab === t ? 'bg-violet-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {tab === 'dashboard' ? <Dashboard /> : <Settings />}
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-2 text-center text-xs text-slate-600">
        Enriches each Tautulli event with the item's real TMDb/TVDb/IMDB id before forwarding to seenr.
      </footer>
    </div>
  );
}
