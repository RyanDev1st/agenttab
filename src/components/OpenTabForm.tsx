import { useState } from 'react'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { Loader2 } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { parseUsdc } from '@/onchain-money'
import { useAgentActions } from '@/hooks/useAgentActions'
import { useNetwork } from '@/hooks/useNetwork'

const EXPIRIES = [
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
]

export function OpenTabForm({ onOpened }: { onOpened: (tabId: bigint) => void }) {
  const { address } = useAccount()
  const { busy, openTab } = useAgentActions()
  const { network } = useNetwork()
  const [provider, setProvider] = useState('')
  const [amount, setAmount] = useState('1.00')
  const [expiry, setExpiry] = useState(EXPIRIES[1].seconds)

  const providerAddr = isAddress(provider) && provider.toLowerCase() !== address?.toLowerCase() ? provider : undefined
  const providerOk = !!providerAddr
  let raw = 0n
  try {
    raw = parseUsdc(amount || '0')
  } catch {
    raw = 0n
  }
  const ready = !!address && providerOk && raw > 0n && network.configured

  async function submit() {
    if (!ready || !providerAddr) return
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + expiry)
    const id = await openTab(providerAddr, raw, expiresAt)
    if (id !== undefined) onOpened(id)
  }

  return (
    <div className="inner space-y-3">
      <div className="label">Open a tab</div>
      <div>
        <input
          className="field mono"
          placeholder="Provider address 0x…"
          value={provider}
          onChange={(e) => setProvider(e.target.value.trim())}
          spellCheck={false}
        />
        {provider && !providerOk && (
          <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>
            {isAddress(provider) ? 'Provider must differ from your wallet.' : 'Enter a valid address.'}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <input
            className="field pr-16 tabular-nums"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              const v = e.target.value
              if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v)
            }}
            aria-label="Deposit amount in USDC"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
            <TokenUSDC variant="branded" size={14} /> USDC
          </span>
        </div>
        <select className="field" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} aria-label="Expiry">
          {EXPIRIES.map((o) => (
            <option key={o.seconds} value={o.seconds}>
              Expires in {o.label}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary w-full" disabled={!ready || busy === 'open'} onClick={() => void submit()}>
        {busy === 'open' ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Opening tab…
          </>
        ) : !address ? (
          'Connect wallet to open a tab'
        ) : (
          'Deposit and open tab'
        )}
      </button>
    </div>
  )
}
