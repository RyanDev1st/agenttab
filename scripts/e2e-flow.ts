/**
 * End-to-end check of the AgentTab flow against a deployed contract, using the same
 * voucher type and domain as the app. Two scenarios:
 *   A) open -> 5 paid calls -> redeem -> 2 more calls -> provider settles and closes (early refund)
 *   B) open -> 3 paid calls -> redeem -> top up -> expiry -> agent closes and gets the refund
 *
 * Needs a real Arc USDC runtime (live Arc Testnet or arc-anvil). A plain anvil fork reverts on USDC transfers.
 *
 * Usage:
 *   RPC_URL=http://127.0.0.1:8547 FORK=1 bun run scripts/e2e-flow.ts   # arc-anvil only
 *   RPC_URL=https://rpc.testnet.arc.io AGENT_KEY=0x.. PROVIDER_KEY=0x.. bun run scripts/e2e-flow.ts
 * Never run this against mainnet.
 */
import { createPublicClient, createWalletClient, erc20Abi, http, parseAbi, parseEventLogs, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.testnet.arc.io'
const FORK = process.env.FORK === '1'
const TAB = '0xe2f9d4a4a498bee2df6f9ed25ba31ff96094e378' as const
const USDC = '0x3600000000000000000000000000000000000000' as const
const PRICE = 10_000n // 0.01 USDC
const ONE = 1_000_000n

if (arcTestnet.id !== 5042002) throw new Error('unexpected chain')

const abi = parseAbi([
  'function openTab(address provider, uint256 amount, uint256 expiresAt) returns (uint256 tabId)',
  'function topUp(uint256 tabId, uint256 amount)',
  'function redeem(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function closeTab(uint256 tabId)',
  'function closeTab(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function getTab(uint256 tabId) view returns ((address client, address provider, uint256 deposit, uint256 paid, uint256 expiresAt, bool closed))',
  'event TabOpened(uint256 indexed tabId, address indexed client, address indexed provider, uint256 amount, uint256 expiresAt)',
])

const types = {
  Voucher: [
    { name: 'tabId', type: 'uint256' },
    { name: 'cumulativeAmount', type: 'uint256' },
  ],
} as const
const domain = { name: 'AgentTab', version: '1', chainId: 5042002, verifyingContract: TAB } as const

const agent = privateKeyToAccount((process.env.AGENT_KEY as Hex) ?? generatePrivateKey())
const provider = privateKeyToAccount((process.env.PROVIDER_KEY as Hex) ?? generatePrivateKey())
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC_URL) })
const agentW = createWalletClient({ account: agent, chain: arcTestnet, transport: http(RPC_URL) })
const providerW = createWalletClient({ account: provider, chain: arcTestnet, transport: http(RPC_URL) })

const log: { step: string; hash: Hex }[] = []
const usd = (n: bigint) => (Number(n) / 1e6).toFixed(2)
const bal = (a: Hex) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })

async function send(step: string, hash: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${step} reverted (${hash})`)
  log.push({ step, hash })
  console.log(`ok  ${step}  ${hash}`)
  return r
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
  console.log(`    check: ${msg}`)
}
const sign = (tabId: bigint, cumulativeAmount: bigint) =>
  agentW.signTypedData({ domain, types, primaryType: 'Voucher', message: { tabId, cumulativeAmount } })

async function openTab(deposit: bigint, ttl: number) {
  const now = BigInt((await pub.getBlock()).timestamp)
  const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [agent.address, TAB] })
  if (allowance < deposit) {
    await send('agent approve USDC', await agentW.writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [TAB, deposit * 2n] }))
  }
  const r = await send(
    `agent openTab (${usd(deposit)} USDC)`,
    await agentW.writeContract({ address: TAB, abi, functionName: 'openTab', args: [provider.address, deposit, now + BigInt(ttl)] }),
  )
  const [ev] = parseEventLogs({ abi, eventName: 'TabOpened', logs: r.logs })
  return ev.args.tabId
}

async function main() {
  console.log(`agent    ${agent.address}\nprovider ${provider.address}\nrpc      ${RPC_URL}${FORK ? ' (fork)' : ''}\n`)
  if (FORK) {
    for (const a of [agent.address, provider.address]) {
      await pub.request({ method: 'anvil_setBalance' as never, params: [a, '0x56BC75E2D63100000'] as never })
    }
  }
  console.log(`agent USDC ${usd(await bal(agent.address))}, provider USDC ${usd(await bal(provider.address))}`)

  // ---- Scenario A: early close by provider
  console.log('\n== Scenario A: 5 calls, redeem, 2 more calls, provider settles and closes')
  const a = await openTab(ONE, 3600)
  let owed = 0n
  let voucher: Hex = '0x'
  for (let i = 1; i <= 5; i++) {
    owed += PRICE
    voucher = await sign(a, owed)
  }
  console.log(`    5 calls signed off-chain, owed ${usd(owed)} USDC`)
  const p0 = await bal(provider.address)
  await send('provider redeem (5 calls)', await providerW.writeContract({ address: TAB, abi, functionName: 'redeem', args: [a, owed, voucher] }))
  const gotA = (await bal(provider.address)) - p0
  // The provider pays the redeem gas in the same USDC, so the balance delta is 0.05 minus a tiny fee.
  assert(gotA <= owed && gotA > owed - 20_000n, `provider balance rose by ${usd(gotA)} USDC (0.05 minus gas)`)
  const afterRedeem = await pub.readContract({ address: TAB, abi, functionName: 'getTab', args: [a] })
  assert(afterRedeem.paid === owed, 'tab.paid == 0.05')

  const stale = await pub.simulateContract({ address: TAB, abi, functionName: 'redeem', args: [a, owed, voucher], account: provider }).then(() => false, () => true)
  assert(stale, 'replaying the same voucher is rejected')

  const wrong = privateKeyToAccount(generatePrivateKey())
  const forged = await wrong.signTypedData({ domain, types, primaryType: 'Voucher', message: { tabId: a, cumulativeAmount: owed + PRICE } })
  const forgedRejected = await pub.simulateContract({ address: TAB, abi, functionName: 'redeem', args: [a, owed + PRICE, forged], account: provider }).then(() => false, () => true)
  assert(forgedRejected, 'a voucher from the wrong signer is rejected')

  owed += 2n * PRICE
  voucher = await sign(a, owed)
  const agentBefore = await bal(agent.address)
  await send('provider settle and close (7 calls)', await providerW.writeContract({ address: TAB, abi, functionName: 'closeTab', args: [a, owed, voucher] }))
  const closedA = await pub.readContract({ address: TAB, abi, functionName: 'getTab', args: [a] })
  assert(closedA.closed && closedA.paid === owed, 'tab closed, provider paid 0.07 total')
  assert((await bal(agent.address)) - agentBefore === ONE - owed, 'agent refunded 0.93 USDC immediately')

  // ---- Scenario B: top up, expiry, client refund
  console.log('\n== Scenario B: 3 calls, redeem, top up, expiry, agent refund')
  const ttl = FORK ? 3600 : 45
  const b = await openTab(ONE, ttl)
  owed = 3n * PRICE
  voucher = await sign(b, owed)
  await send('provider redeem (3 calls)', await providerW.writeContract({ address: TAB, abi, functionName: 'redeem', args: [b, owed, voucher] }))
  await send('agent topUp (0.50 USDC)', await agentW.writeContract({ address: TAB, abi, functionName: 'topUp', args: [b, ONE / 2n] }))
  const tb = await pub.readContract({ address: TAB, abi, functionName: 'getTab', args: [b] })
  assert(tb.deposit === ONE + ONE / 2n, 'deposit is now 1.50')
  const early = await pub.simulateContract({ address: TAB, abi, functionName: 'closeTab', args: [b], account: agent }).then(() => false, () => true)
  assert(early, 'agent cannot refund before expiry')

  if (FORK) {
    await pub.request({ method: 'evm_increaseTime' as never, params: [ttl + 5] as never })
    await pub.request({ method: 'evm_mine' as never, params: [] as never })
  } else {
    console.log(`    waiting for expiry (${ttl}s)...`)
    while (BigInt((await pub.getBlock()).timestamp) < tb.expiresAt) await new Promise((r) => setTimeout(r, 3000))
  }
  const agentBefore2 = await bal(agent.address)
  await send('agent closeTab (refund after expiry)', await agentW.writeContract({ address: TAB, abi, functionName: 'closeTab', args: [b] }))
  const closedB = await pub.readContract({ address: TAB, abi, functionName: 'getTab', args: [b] })
  assert(closedB.closed, 'tab closed')
  const refundDelta = (await bal(agent.address)) - agentBefore2
  console.log(`    agent balance delta ${usd(refundDelta)} USDC (refund 1.47 minus gas, paid in USDC)`)

  console.log('\nTransactions:')
  for (const l of log) console.log(`${l.step}\n  https://explorer.testnet.arc.io/tx/${l.hash}`)
  console.log('\nALL CHECKS PASSED')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
