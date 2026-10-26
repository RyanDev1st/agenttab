import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Bot } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { shortAddress } from '@/lib/format'
import { SwitchAccountButton } from './NetworkControls'
import { OpenTabForm } from './OpenTabForm'
import { AgentTabCard } from './AgentTabCard'

export function AgentPanel() {
  const { address } = useAccount()
  const { tabs, isLoading } = useTabs(address)
  const [selected, setSelected] = useState<bigint | null>(null)

  const mine = tabs.filter((t) => t.client.toLowerCase() === address?.toLowerCase())
  const active = mine.find((t) => t.id === selected) ?? mine[0]

  return (
    <section className="card space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--surface-muted)' }}>
          <Bot className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="display text-xl font-bold">Agent (client)</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {address ? `Acting as ${shortAddress(address)}` : 'Connect a wallet to act as the agent'}
          </p>
        </div>
        <SwitchAccountButton />
      </header>

      <OpenTabForm onOpened={setSelected} />

      {address && isLoading && <div className="h-28 animate-pulse rounded-2xl" style={{ background: 'var(--surface-muted)' }} />}

      {mine.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Your tabs">
          {mine.map((t) => (
            <button
              key={t.id.toString()}
              role="tab"
              aria-selected={t.id === active?.id}
              onClick={() => setSelected(t.id)}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderColor: t.id === active?.id ? 'var(--accent)' : 'var(--border)',
                background: t.id === active?.id ? 'var(--accent)' : 'white',
                color: t.id === active?.id ? 'white' : 'var(--ink)',
              }}
            >
              Tab #{t.id.toString()}
              {t.closed ? ' · closed' : ''}
            </button>
          ))}
        </div>
      )}

      {active ? (
        <AgentTabCard key={active.id.toString()} tab={active} />
      ) : (
        address &&
        !isLoading && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No tabs yet. Open one above, then call the paid API as many times as you like.
          </p>
        )
      )}
    </section>
  )
}
