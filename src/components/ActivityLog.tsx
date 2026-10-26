import { CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react'
import { useTx } from '@/hooks/useTx'
import { shortAddress } from '@/lib/format'
import { txUrl } from '@/config/networks'

export function ActivityLog() {
  const { entries } = useTx()
  if (entries.length === 0) return null

  return (
    <section className="card">
      <div className="label mb-3">Transactions</div>
      <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2.5 text-sm font-medium">
              {e.status === 'pending' ? (
                <Loader2 className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} />
              ) : e.status === 'success' ? (
                <CheckCircle2 className="size-4" style={{ color: 'var(--success)' }} />
              ) : (
                <XCircle className="size-4" style={{ color: 'var(--danger)' }} />
              )}
              {e.label}
            </div>
            <a
              href={txUrl(e.network, e.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--accent-hover)' }}
            >
              {shortAddress(e.hash)} <ExternalLink className="size-3" />
              <span className="sr-only">on {e.network.label} explorer</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
