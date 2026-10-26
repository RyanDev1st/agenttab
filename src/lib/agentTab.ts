import { parseAbi, type Address } from 'viem'
import { parseUsdc } from '@/onchain-money'

/** Price of one simulated API call. */
export const CALL_PRICE = parseUsdc('0.01')

export const agentTabAbi = parseAbi([
  'function openTab(address provider, uint256 amount, uint256 expiresAt) returns (uint256 tabId)',
  'function topUp(uint256 tabId, uint256 amount)',
  'function redeem(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function closeTab(uint256 tabId)',
  'function closeTab(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function getTab(uint256 tabId) view returns ((address client, address provider, uint256 deposit, uint256 paid, uint256 expiresAt, bool closed))',
  'function tabsOf(address who) view returns (uint256[])',
  'event TabOpened(uint256 indexed tabId, address indexed client, address indexed provider, uint256 amount, uint256 expiresAt)',
  'event Redeemed(uint256 indexed tabId, address indexed provider, uint256 amount, uint256 totalPaid)',
  'error InvalidProvider()',
  'error InvalidAmount()',
  'error InvalidExpiry()',
  'error TabNotFound()',
  'error NotClient()',
  'error NotProvider()',
  'error TabAlreadyClosed()',
  'error TabExpired()',
  'error TabNotExpired()',
  'error InvalidSignature()',
  'error StaleVoucher()',
])

export const voucherTypes = {
  Voucher: [
    { name: 'tabId', type: 'uint256' },
    { name: 'cumulativeAmount', type: 'uint256' },
  ],
} as const

export interface Tab {
  id: bigint
  client: Address
  provider: Address
  deposit: bigint
  paid: bigint
  expiresAt: bigint
  closed: boolean
}
