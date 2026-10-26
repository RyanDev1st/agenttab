import { useAccount } from 'wagmi'
import { Loader2, Server, ReceiptText } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { useAgentActions } from '@/hooks/useAgentActions'
import { useNow } from '@/hooks/useNow'
import { CALL_PRICE, type Tab } from '@/lib/agentTab'
import { useNetwork } from '@/hooks/useNetwork'
import { shortAddress, usd } from '@/lib/format'
import { readVoucher, useVoucherVersion } from '@/lib/vouchers'
import { Stat, StatusPill } from './Stat'
import { SwitchAccountButton } from './NetworkControls'

function ProviderTabCard({ tab }: { tab: Tab }) {
  useVoucherVersion()
  const now = useNow()
  const { network } = useNetwork()
  const { busy, redeem, settleAndClose } = useAgentActions()

  const voucher = readVoucher(network, tab.id)
  const signed = voucher ? BigInt(voucher.cumulativeAmount) : 0n
  const effective = signed < tab.deposit ? signed : tab.deposit
  const redeemable = effective > tab.paid ? effective - tab.paid : 0n
  const expired = BigInt(now) >= tab.expiresAt

  return (
    <div className="inner space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="display text-lg font-semibold">Tab #{tab.id.toString()}</div>
          <div className="mono text-xs" style={{ color: 'var(--muted)' }}>
            from {shortAddress(tab.client)}
          </div>
        </div>
        {tab.closed ? (
          <StatusPill tone="done">Closed</StatusPill>
        ) : expired ? (
          <StatusPill tone="warn">Expired: redeem now</StatusPill>
        ) : (
          <StatusPill tone="ok">Open</StatusPill>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Latest voucher"
          value={usd(signed)}
          hint={voucher ? `${voucher.calls} calls × ${usd(CALL_PRICE)}` : 'None received yet'}
        />
        <Stat label="Paid so far" value={usd(tab.paid)} hint={`of ${usd(tab.deposit)} deposit`} />
        <Stat label="Redeemable" value={usd(redeemable)} />
      </div>

      {!tab.closed && (
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn-primary"
            disabled={redeemable === 0n || !voucher || busy === `redeem-${tab.id}`}
            onClick={() => voucher && void redeem(tab.id, signed, voucher.signature)}
          >
            {busy === `redeem-${tab.id}` ? <Loader2 className="size-4 animate-spin" /> : <ReceiptText className="size-4" />}
            Redeem
          </button>
          <button
            className="btn-ghost"
            disabled={busy === `settle-${tab.id}`}
            onClick={() => void settleAndClose(tab.id, voucher ? signed : 0n, voucher ? voucher.signature : '0x')}
          >
            {busy === `settle-${tab.id}` && <Loader2 className="size-4 animate-spin" />}
            Settle and close
          </button>
        </div>
      )}
      {!tab.closed && (
        <p className="-mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          Settle and close pays the latest voucher and refunds the rest to the agent right away.
        </p>
      )}
    </div>
  )
}

export function ProviderPanel() {
  const { address } = useAccount()
  const { tabs, isLoading } = useTabs(address)
  const incoming = tabs.filter((t) => t.provider.toLowerCase() === address?.toLowerCase())

  return (
    <section className="card space-y-4">
      <header className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl" style={{ background: 'var(--surface-muted)' }}>
          <Server className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="display text-xl font-bold">API provider</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {address ? `Showing tabs paid to ${shortAddress(address)}` : 'Connect the provider wallet to see its tabs'}
          </p>
        </div>
        <SwitchAccountButton />
      </header>

      {address && isLoading && <div className="h-28 animate-pulse rounded-2xl" style={{ background: 'var(--surface-muted)' }} />}

      {incoming.map((t) => (
        <ProviderTabCard key={t.id.toString()} tab={t} />
      ))}

      {address && !isLoading && incoming.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No tabs are paying this account. Open a tab on the agent side using this account's address as the provider, switch
          to the agent account to make calls, then switch back here to redeem.
        </p>
      )}
      <div className="inner text-xs" style={{ color: 'var(--muted)' }}>
        <div className="label mb-1">Voucher inbox (demo stand-in)</div>
        Latest vouchers are read from this browser's localStorage. This stands in for the HTTP 402 / payment header flow:
        your API answers 402 with a price, the agent retries with its newest signed voucher in a payment header, and you
        keep the latest one to redeem.
      </div>
    </section>
  )
}
