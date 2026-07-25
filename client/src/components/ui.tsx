import React, { useState } from 'react';
import { createPortal } from 'react-dom';

export function Card({ title, subtitle, children, actions }: {
  title?: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] shadow-lg shadow-black/20">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-white">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${accent || 'text-white'}`}>{value}</div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'red' | 'amber' | 'slate' | 'violet'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    red: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    slate: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
    violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>{children}</span>;
}

export function Button({ children, onClick, variant = 'primary', disabled, type }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit';
}) {
  const variants: Record<string, string> = {
    primary: 'bg-violet-600 hover:bg-violet-500 text-white',
    ghost: 'bg-white/5 hover:bg-white/10 text-slate-200 ring-1 ring-white/10',
    danger: 'bg-rose-600/90 hover:bg-rose-500 text-white',
  };
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg border border-transparent px-3.5 py-2 text-sm font-medium leading-5 transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium text-slate-200">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 ${props.className || ''}`}
    />
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${checked ? 'bg-violet-600' : 'bg-slate-600'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#0e1320] shadow-2xl shadow-black/50">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 transition hover:text-white">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-3 border-t border-white/10 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-slate-200">{label}</div>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 overflow-x-auto whitespace-pre rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-200">{value}</code>
        <button
          type="button"
          onClick={copy}
          className={`shrink-0 rounded-lg border border-transparent px-3 py-2 text-sm font-medium transition ${
            copied ? 'bg-emerald-600 text-white' : 'bg-white/5 text-slate-200 ring-1 ring-white/10 hover:bg-white/10'
          }`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
