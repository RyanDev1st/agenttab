import type { ReactNode } from 'react'

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="display mt-1 text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'done'; children: ReactNode }) {
  const color = tone === 'ok' ? 'var(--success)' : tone === 'warn' ? 'var(--danger)' : 'var(--subtle)'
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ color, background: 'var(--surface-muted)' }}
    >
      {children}
    </span>
  )
}
