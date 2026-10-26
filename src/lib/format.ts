import { formatUnitsFixed } from '@/onchain-money'
import { USDC_DECIMALS } from '@/onchain-facts'

/** USDC with exactly 2 decimals, e.g. "1.00". */
export function usd(raw: bigint): string {
  return formatUnitsFixed(raw, USDC_DECIMALS, 2)
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function countdown(expiresAt: bigint, nowSec: number): string {
  const left = Number(expiresAt) - nowSec
  if (left <= 0) return 'Expired'
  const d = Math.floor(left / 86400)
  const h = Math.floor((left % 86400) / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  if (m > 0) return `${m}m ${s}s left`
  return `${s}s left`
}

const KNOWN_ERRORS: Record<string, string> = {
  InvalidProvider: 'Provider must be a different, non-zero address.',
  InvalidAmount: 'Amount must be greater than zero.',
  InvalidExpiry: 'Expiry must be in the future.',
  TabNotFound: 'That tab does not exist.',
  NotClient: 'Only the agent (client) can do this.',
  NotProvider: 'Only the provider can do this.',
  TabAlreadyClosed: 'This tab is already closed.',
  TabExpired: 'This tab has expired.',
  TabNotExpired: 'The tab has not expired yet, so it cannot be refunded.',
  InvalidSignature: 'The voucher signature is not from the tab client.',
  StaleVoucher: 'Nothing new to redeem: this voucher is already settled.',
}

export function parseError(error: unknown): string | null {
  const e = error as { shortMessage?: string; message?: string; code?: number; name?: string } | null
  const message = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`
  const lower = message.toLowerCase()
  if (e?.code === 4001 || lower.includes('user rejected') || lower.includes('user denied')) return null
  for (const [name, text] of Object.entries(KNOWN_ERRORS)) {
    if (message.includes(name)) return text
  }
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Insufficient USDC balance. Use Get test USDC in the sidebar.'
  }
  if (lower.includes('network') || lower.includes('timeout')) return 'Network issue. Please retry.'
  return 'Something went wrong. Please try again.'
}
