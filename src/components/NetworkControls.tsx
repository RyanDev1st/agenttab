import { useState } from 'react'
import { useAccount } from 'wagmi'
import { AlertTriangle, Repeat } from 'lucide-react'
import { NETWORK_LIST, addressUrl } from '@/config/networks'
import { useNetwork } from '@/hooks/useNetwork'

export function NetworkSwitcher() {
  const { network, setNetwork } = useNetwork()
  return (
    <div
      className="inline-flex rounded-2xl border p-1"
      style={{ background: 'var(--surface-muted)', borderColor: 'var(--border)' }}
      role="group"
      aria-label="Network"
    >
      {NETWORK_LIST.map((n) => {
        const active = n.key === network.key
        return (
          <button
            key={n.key}
            aria-pressed={active}
            onClick={() => setNetwork(n.key)}
            className="rounded-xl px-3 text-xs font-semibold transition-colors"
            style={{
              minHeight: 36,
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'white' : 'var(--ink-2)',
            }}
          >
            {n.label}
          </button>
        )
      })}
    </div>
  )
}

export function NetworkBanner() {
  const { network } = useNetwork()
  if (network.isTestnet) return null
  if (!network.configured) {
    return (
      <div className="inner flex items-start gap-3 text-sm" style={{ borderColor: 'var(--danger)' }}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} />
        <p>
          AgentTab is not deployed on {network.label} yet. Set <span className="mono">AGENT_TAB_MAINNET_ADDRESS</span> in{' '}
          <span className="mono">src/config/networks.ts</span> after you deploy. Transactions are disabled until then.
        </p>
      </div>
    )
  }
  return (
    <div className="inner flex items-start gap-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} />
      <p>
        You are on {network.label}. Deposits and payments move real USDC and cannot be undone. Contract:{' '}
        <a
          className="mono underline underline-offset-2"
          href={addressUrl(network, network.agentTab)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {network.agentTab.slice(0, 8)}…{network.agentTab.slice(-4)}
        </a>
      </p>
    </div>
  )
}

/** Asks the wallet to pick a different account for this site (MetaMask-style EIP-2255 permissions). */
export function SwitchAccountButton() {
  const { connector, isConnected } = useAccount()
  const [busy, setBusy] = useState(false)
  if (!isConnected || !connector) return null

  async function switchAccount() {
    setBusy(true)
    try {
      const provider = (await connector?.getProvider()) as
        | { request: (args: { method: string; params?: unknown }) => Promise<unknown> }
        | undefined
      await provider?.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
    } catch {
      // Cancelled, or the wallet does not support it. The wallet's own account menu still works.
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn-ghost !min-h-9 !px-3 text-xs" disabled={busy} onClick={() => void switchAccount()}>
      <Repeat className="size-3.5" /> Switch account
    </button>
  )
}
