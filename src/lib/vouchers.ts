import { useSyncExternalStore } from 'react'
import type { Hex } from 'viem'
import type { NetworkConfig } from '@/config/networks'

/**
 * Voucher hand-off: a DEMO STAND-IN for an HTTP 402 / payment header.
 *
 * In production the API answers 402 Payment Required with its price, the agent retries
 * the request with the newest signed voucher in a payment header, and the provider keeps
 * the latest one. Here the "API" is simulated inside one browser, so the latest voucher
 * per tab is kept in localStorage where the provider view reads it.
 */
export interface StoredVoucher {
  tabId: string
  cumulativeAmount: string
  signature: Hex
  calls: number
  signedAt: number
}

const EVENT = 'agenttab:vouchers'
const keyFor = (n: NetworkConfig, tabId: bigint) => `agenttab:voucher:${n.chainId}:${n.agentTab.toLowerCase()}:${tabId}`

let cache = ''
function snapshot(): string {
  const entries: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('agenttab:voucher:')) entries.push(`${key}=${localStorage.getItem(key)}`)
  }
  const next = entries.sort().join('|')
  if (next !== cache) cache = next
  return cache
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function readVoucher(n: NetworkConfig, tabId: bigint): StoredVoucher | undefined {
  const raw = localStorage.getItem(keyFor(n, tabId))
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as StoredVoucher
  } catch {
    return undefined
  }
}

export function saveVoucher(n: NetworkConfig, tabId: bigint, voucher: Omit<StoredVoucher, 'tabId' | 'signedAt'>) {
  const stored: StoredVoucher = { ...voucher, tabId: tabId.toString(), signedAt: Date.now() }
  localStorage.setItem(keyFor(n, tabId), JSON.stringify(stored))
  window.dispatchEvent(new Event(EVENT))
}

/** Re-renders when any voucher changes; read vouchers with `readVoucher` inside the component. */
export function useVoucherVersion(): string {
  return useSyncExternalStore(subscribe, snapshot, () => '')
}
