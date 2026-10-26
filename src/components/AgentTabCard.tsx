import { useState } from 'react'
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi'
import { Loader2, PenLine, RotateCcw, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { CALL_PRICE, voucherTypes, type Tab } from '@/lib/agentTab'
import { useNetwork } from '@/hooks/useNetwork'
import { countdown, parseError, shortAddress, usd } from '@/lib/format'
import { readVoucher, saveVoucher, useVoucherVersion } from '@/lib/vouchers'
import { parseUsdc } from '@/onchain-money'
import { useAgentActions } from '@/hooks/useAgentActions'
import { useNow } from '@/hooks/useNow'
import { Stat, StatusPill } from './Stat'

export function AgentTabCard({ tab }: { tab: Tab }) {
  useVoucherVersion()
  const now = useNow()
  const { chainId } = useAccount()
  const { network, voucherDomain } = useNetwork()
  const CHAIN_ID = network.chainId
  const { switchChainAsync } = useSwitchChain()
  const { signTypedDataAsync } = useSignTypedData()
  const { busy, topUp, refund } = useAgentActions()
  const [signing, setSigning] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState('1.00')

  const voucher = readVoucher(network, tab.id)
  const owed = voucher ? BigInt(voucher.cumulativeAmount) : 0n
  const calls = voucher?.calls ?? 0
  const left = tab.deposit > owed ? tab.deposit - owed : 0n
  const expired = BigInt(now) >= tab.expiresAt
  const canCall = !tab.closed && !expired && owed + CALL_PRICE <= tab.deposit

  async function callApi() {
    setSigning(true)
    try {
      if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
      const next = owed + CALL_PRICE
      const signature = await signTypedDataAsync({
        domain: voucherDomain,
        types: voucherTypes,
        primaryType: 'Voucher',
        message: { tabId: tab.id, cumulativeAmount: next },
      })
      saveVoucher(network, tab.id, { cumulativeAmount: next.toString(), signature, calls: calls + 1 })
    } catch (error) {
      const text = parseError(error)
      if (text) toast.error(text)
    } finally {
      setSigning(false)
    }
  }

  let topUpRaw = 0n
  try {
    topUpRaw = parseUsdc(topUpAmount || '0')
  } catch {
    topUpRaw = 0n
  }

  const status = tab.closed ? (
    <StatusPill tone="done">Closed</StatusPill>
  ) : expired ? (
    <StatusPill tone="warn">Expired</StatusPill>
  ) : (
    <StatusPill tone="ok">{countdown(tab.expiresAt, now)}</StatusPill>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="display text-lg font-semibold">Tab #{tab.id.toString()}</div>
          <div className="mono text-xs" style={{ color: 'var(--muted)' }}>
            to {shortAddress(tab.provider)}
          </div>
        </div>
        {status}
      </div>

      <div className="inner grid grid-cols-3 gap-3">
        <Stat label="Calls made" value={calls} hint={`${usd(CALL_PRICE)} each`} />
        <Stat label="USDC owed" value={usd(owed)} hint={`of ${usd(tab.deposit)} deposit`} />
        <Stat label="Left" value={usd(left)} hint={`${usd(tab.paid)} paid onchain`} />
      </div>

      <button className="btn-primary w-full" disabled={!canCall || signing} onClick={() => void callApi()}>
        {signing ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Sign in wallet…
          </>
        ) : (
          <>
            <PenLine className="size-4" /> Call paid API ({usd(CALL_PRICE)} USDC)
          </>
        )}
      </button>
      <p className="-mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        {tab.closed
          ? 'This tab is closed.'
          : expired
            ? 'Tab expired. Refund the unspent USDC below.'
            : !canCall
              ? 'Tab balance used up. Top up to keep calling.'
              : 'Signs an off-chain voucher. No gas, no transaction. Stands in for retrying a 402 response with a payment header.'}
      </p>

      {!tab.closed && (
        <div className="flex gap-2">
          <input
            className="field tabular-nums"
            inputMode="decimal"
            value={topUpAmount}
            disabled={expired}
            onChange={(e) => {
              if (/^\d*\.?\d{0,6}$/.test(e.target.value)) setTopUpAmount(e.target.value)
            }}
            aria-label="Top up amount in USDC"
          />
          <button
            className="btn-ghost shrink-0"
            disabled={expired || topUpRaw === 0n || busy === `topup-${tab.id}`}
            onClick={() => void topUp(tab.id, topUpRaw)}
          >
            {busy === `topup-${tab.id}` ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Top up
          </button>
        </div>
      )}

      {!tab.closed && (
        <button
          className="btn-ghost w-full"
          disabled={!expired || busy === `refund-${tab.id}`}
          onClick={() => void refund(tab.id)}
        >
          {busy === `refund-${tab.id}` ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
          {expired ? 'Close tab and refund' : 'Refund opens after expiry'}
        </button>
      )}
    </div>
  )
}
