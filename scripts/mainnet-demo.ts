/**
 * AgentTab demo run for Arc (mainnet by default). Small amounts, every step prints its tx hash and explorer link.
 *
 *   AGENT_KEY=0x.. PROVIDER_KEY=0x.. bun run scripts/mainnet-demo.ts --dry-run   # simulate only, sends nothing
 *   AGENT_KEY=0x.. PROVIDER_KEY=0x.. bun run scripts/mainnet-demo.ts             # real transactions on Arc Mainnet
 *
 * Env:
 *   AGENT_KEY, PROVIDER_KEY  required, two different funded keys (never printed)
 *   AGENT_TAB_ADDRESS        optional, an existing AgentTab. If empty the script deploys one first.
 *   DEMO_NETWORK=testnet     optional, run against Arc Testnet instead (used to rehearse this script)
 *   RPC_URL                  optional override; the script refuses an RPC whose chain id does not match
 * Flags: --dry-run (estimate / eth_call only), --yes (skip the mainnet confirmation prompt)
 *
 * Mainnet transactions use real USDC and are irreversible. You run this yourself, with your own keys.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  erc20Abi,
  getContractAddress,
  hashTypedData,
  http,
  isAddress,
  parseAbi,
  parseEventLogs,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arc, arcTestnet } from 'viem/chains'
import { buildTxExplorerUrl, requireChain } from '../src/onchain-facts'
import { Amount, formatAmount, parseAmount, usdcDecimalsFor, usdcToGasToken } from '../src/onchain-money'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DRY = process.argv.includes('--dry-run')
const YES = process.argv.includes('--yes')
const chain = process.env.DEMO_NETWORK === 'testnet' ? arcTestnet : arc
const isMainnet = chain.id === arc.id
const facts = requireChain(chain.id)
if (!facts.usdc) throw new Error(`No USDC for chain ${chain.id} in the onchain facts registry`)
const USDC = facts.usdc.address as Address
const RPC = process.env.RPC_URL ?? facts.rpcUrls[0]
const usd = (raw: bigint) => formatAmount(chain.id, Amount.fromRaw(raw, usdcDecimalsFor(chain.id)))
const amt = (s: string) => parseAmount(chain.id, s).raw

const PRICE = amt('0.01')
const DEPOSIT = amt('0.10')
const GAS_TOPUP = amt('0.20')
const PROVIDER_MIN = amt('0.10')
const AGENT_MIN = amt('0.40')
const MIN_FEE = 20_000_000_000n // Arc rejects maxFeePerGas below 20 gwei

const abi = parseAbi([
  'constructor(address _usdc)',
  'function usdc() view returns (address)',
  'function nextTabId() view returns (uint256)',
  'function openTab(address provider, uint256 amount, uint256 expiresAt) returns (uint256 tabId)',
  'function redeem(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function closeTab(uint256 tabId, uint256 cumulativeAmount, bytes signature)',
  'function hashVoucher(uint256 tabId, uint256 cumulativeAmount) view returns (bytes32)',
  'function getTab(uint256 tabId) view returns ((address client, address provider, uint256 deposit, uint256 paid, uint256 expiresAt, bool closed))',
  'event TabOpened(uint256 indexed tabId, address indexed client, address indexed provider, uint256 amount, uint256 expiresAt)',
])
const voucherTypes = {
  Voucher: [
    { name: 'tabId', type: 'uint256' },
    { name: 'cumulativeAmount', type: 'uint256' },
  ],
} as const

function key(name: string): Hex {
  const v = process.env[name]
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be set to a 0x-prefixed 32-byte hex private key`)
  return v as Hex
}

const agent = privateKeyToAccount(key('AGENT_KEY'))
const provider = privateKeyToAccount(key('PROVIDER_KEY'))
if (agent.address === provider.address) throw new Error('AGENT_KEY and PROVIDER_KEY must be different keys')

const transport = http(RPC)
const pub = createPublicClient({ chain, transport })
const agentW = createWalletClient({ account: agent, chain, transport })
const providerW = createWalletClient({ account: provider, chain, transport })

interface TxRecord {
  step: string
  hash: Hex
  explorer: string
  gasUsed: string
}
const txs: TxRecord[] = []
const notes: string[] = []
const bal = (a: Address) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a] })
const say = (s = '') => console.log(s)

async function fees() {
  const e = await pub.estimateFeesPerGas()
  return { maxFeePerGas: e.maxFeePerGas > MIN_FEE ? e.maxFeePerGas : MIN_FEE, maxPriorityFeePerGas: e.maxPriorityFeePerGas }
}

type Wallet = typeof agentW
interface Req {
  to?: Address
  data?: Hex
  value?: bigint
}

/** Sends the tx, or in --dry-run mode only estimates its gas. Returns the receipt (undefined in dry-run). */
async function run(step: string, w: Wallet, req: Req) {
  if (DRY) {
    const gas = await pub.estimateGas({ account: w.account, ...req })
    const f = await fees()
    say(`  [dry-run] ${step}: would succeed, gas ${gas}, about ${(Number(gas * f.maxFeePerGas) / 1e18).toFixed(4)} USDC in fees`)
    return undefined
  }
  const hash = await w.sendTransaction({ ...req, ...(await fees()), chain })
  const url = buildTxExplorerUrl(chain.id, hash)
  say(`  ${step}\n    tx   ${hash}\n    link ${url}`)
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${step} reverted onchain: ${url}`)
  txs.push({ step, hash, explorer: url, gasUsed: receipt.gasUsed.toString() })
  return receipt
}

function dependent(step: string, why: string) {
  say(`  [dry-run] ${step}: not simulable yet (${why}); encoding and signature checked`)
  notes.push(`${step}: depends on earlier steps landing onchain`)
}

async function confirm() {
  if (DRY || YES || !isMainnet) return
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const a = await rl.question(`\nThis sends REAL transactions on ${facts.name} with real USDC. Type "mainnet" to continue: `)
  rl.close()
  if (a.trim() !== 'mainnet') throw new Error('Aborted, nothing was sent.')
}

async function main() {
  const started = new Date().toISOString()
  say(`AgentTab demo on ${facts.name} (chain ${chain.id})${DRY ? '  [DRY RUN, nothing is sent]' : ''}`)
  say(`RPC      ${RPC}\nUSDC     ${USDC}\nagent    ${agent.address}\nprovider ${provider.address}\n`)

  const remoteId = await pub.getChainId()
  if (remoteId !== chain.id) throw new Error(`RPC reports chain ${remoteId}, expected ${chain.id}. Refusing to continue.`)

  const before = { agent: await bal(agent.address), provider: await bal(provider.address) }
  say(`Balances: agent ${usd(before.agent)} USDC, provider ${usd(before.provider)} USDC`)
  if (before.agent < AGENT_MIN) {
    throw new Error(`Agent balance ${usd(before.agent)} USDC is below the ${usd(AGENT_MIN)} USDC minimum. Refusing to run.`)
  }
  await confirm()

  // ---- a. contract
  say('\n[a] AgentTab contract')
  let tab = process.env.AGENT_TAB_ADDRESS?.trim() as Address | undefined
  let deployedOnChain = false
  if (tab) {
    if (!isAddress(tab)) throw new Error('AGENT_TAB_ADDRESS is not a valid address')
    const code = await pub.getCode({ address: tab })
    if (!code || code === '0x') throw new Error(`No contract code at AGENT_TAB_ADDRESS on ${facts.name}`)
    const tokenInUse = await pub.readContract({ address: tab, abi, functionName: 'usdc' })
    if (tokenInUse.toLowerCase() !== USDC.toLowerCase()) throw new Error(`That AgentTab uses ${tokenInUse}, not ${USDC}`)
    say(`  using existing AgentTab ${tab} (USDC matches)`)
    deployedOnChain = true
  } else {
    const artifactPath = path.resolve(HERE, '../contracts/out/AgentTab.sol/AgentTab.json')
    if (!fs.existsSync(artifactPath)) throw new Error('Missing contracts/out/AgentTab.sol/AgentTab.json. Run `forge build` first.')
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { bytecode: { object: Hex } }
    const data = encodeDeployData({ abi, bytecode: artifact.bytecode.object, args: [USDC] })
    if (DRY) {
      const runtime = await pub.call({ account: agent, data })
      say(`  [dry-run] constructor runs fine with the ${facts.name} USDC, runtime code ${((runtime.data?.length ?? 2) - 2) / 2} bytes`)
      tab = getContractAddress({ from: agent.address, nonce: BigInt(await pub.getTransactionCount({ address: agent.address })) })
    }
    const r = await run('Deploy AgentTab', agentW, { data })
    if (r) {
      if (!r.contractAddress) throw new Error('Deployment receipt has no contract address')
      tab = r.contractAddress
    }
    say(`  AgentTab address${DRY ? ' (predicted)' : ''}: ${tab}`)
    deployedOnChain = !DRY
  }
  if (!tab) throw new Error('No AgentTab address')
  const tabAddr: Address = tab

  // ---- b. gas for the provider
  say('\n[b] Provider gas')
  if (before.provider < PROVIDER_MIN) {
    const value = usdcToGasToken(chain.id, Amount.fromRaw(GAS_TOPUP, usdcDecimalsFor(chain.id))).raw
    await run(`Agent sends provider ${usd(GAS_TOPUP)} USDC for gas (native transfer)`, agentW, { to: provider.address, value })
  } else {
    say(`  provider already holds ${usd(before.provider)} USDC, no top-up needed`)
  }

  // ---- c. approve and open
  say('\n[c] Approve and open tab')
  const allowance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [agent.address, tabAddr] })
  if (allowance < DEPOSIT) {
    await run(`Agent approves ${usd(DEPOSIT)} USDC`, agentW, {
      to: USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [tabAddr, DEPOSIT] }),
    })
  } else {
    say(`  allowance already ${usd(allowance)} USDC`)
  }
  const now = (await pub.getBlock()).timestamp
  const openData = encodeFunctionData({ abi, functionName: 'openTab', args: [provider.address, DEPOSIT, now + 3600n] })
  let tabId = deployedOnChain ? await pub.readContract({ address: tabAddr, abi, functionName: 'nextTabId' }) : 1n
  if (DRY && (!deployedOnChain || allowance < DEPOSIT)) {
    dependent('Agent opens tab', !deployedOnChain ? 'the contract is not deployed yet' : 'the approval has not landed yet')
  } else {
    const r = await run(`Agent opens tab for provider: ${usd(DEPOSIT)} USDC, expires in 1 hour`, agentW, { to: tabAddr, data: openData })
    if (r) {
      const [ev] = parseEventLogs({ abi, eventName: 'TabOpened', logs: r.logs })
      tabId = ev.args.tabId
    }
  }
  say(`  tab id${DRY ? ' (expected)' : ''}: ${tabId}`)

  // ---- d. three paid calls, provider redeems
  const domain = { name: 'AgentTab', version: '1', chainId: chain.id, verifyingContract: tabAddr } as const
  const sign = async (n: number) => {
    const message = { tabId, cumulativeAmount: PRICE * BigInt(n) }
    const signature = await agent.signTypedData({ domain, types: voucherTypes, primaryType: 'Voucher', message })
    const ok = await verifyTypedData({ address: agent.address, domain, types: voucherTypes, primaryType: 'Voucher', message, signature })
    if (!ok) throw new Error('Local voucher signature check failed')
    return { signature, cumulative: message.cumulativeAmount }
  }
  const checkDomain = async () => {
    if (!deployedOnChain) return
    const onchain = await pub.readContract({ address: tabAddr, abi, functionName: 'hashVoucher', args: [tabId, PRICE] })
    const local = hashTypedData({ domain, types: voucherTypes, primaryType: 'Voucher', message: { tabId, cumulativeAmount: PRICE } })
    if (onchain !== local) throw new Error('EIP-712 digest mismatch between this script and the deployed contract')
    say('  EIP-712 digest matches the deployed contract')
  }

  say('\n[d] Three paid calls (0.01 each), provider redeems')
  await checkDomain()
  let v = await sign(1)
  say(`  call 1 voucher signed off-chain (cumulative ${usd(v.cumulative)})`)
  v = await sign(2)
  say(`  call 2 voucher signed off-chain (cumulative ${usd(v.cumulative)})`)
  v = await sign(3)
  say(`  call 3 voucher signed off-chain (cumulative ${usd(v.cumulative)})`)
  if (DRY) {
    dependent('Provider redeems 0.03 USDC', 'the tab does not exist until it is opened')
  } else {
    await run(`Provider redeems ${usd(v.cumulative)} USDC`, providerW, {
      to: tabAddr,
      data: encodeFunctionData({ abi, functionName: 'redeem', args: [tabId, v.cumulative, v.signature] }),
    })
    const t = await pub.readContract({ address: tabAddr, abi, functionName: 'getTab', args: [tabId] })
    if (t.paid !== v.cumulative) throw new Error(`Expected paid ${usd(v.cumulative)}, got ${usd(t.paid)}`)
  }

  // ---- e. two more calls, settle and close
  say('\n[e] Two more calls (cumulative 0.05), provider settles and closes early')
  v = await sign(4)
  say(`  call 4 voucher signed off-chain (cumulative ${usd(v.cumulative)})`)
  v = await sign(5)
  say(`  call 5 voucher signed off-chain (cumulative ${usd(v.cumulative)})`)
  const agentBeforeClose = await bal(agent.address)
  if (DRY) {
    dependent('Provider settles and closes, refunding the agent', 'the tab does not exist until it is opened')
  } else {
    await run(`Provider settles ${usd(v.cumulative)} USDC and closes the tab`, providerW, {
      to: tabAddr,
      data: encodeFunctionData({ abi, functionName: 'closeTab', args: [tabId, v.cumulative, v.signature] }),
    })
    const t = await pub.readContract({ address: tabAddr, abi, functionName: 'getTab', args: [tabId] })
    if (!t.closed || t.paid !== v.cumulative) throw new Error('Tab is not closed with the expected paid amount')
    const refund = (await bal(agent.address)) - agentBeforeClose
    if (refund !== DEPOSIT - v.cumulative) throw new Error(`Expected refund ${usd(DEPOSIT - v.cumulative)}, got ${usd(refund)}`)
    say(`  agent refunded ${usd(refund)} USDC`)
  }

  // ---- f. summary
  const after = { agent: await bal(agent.address), provider: await bal(provider.address) }
  const topUpSent = before.provider < PROVIDER_MIN ? GAS_TOPUP : 0n
  const summary = {
    mode: DRY ? 'dry-run' : 'live',
    network: facts.name,
    chainId: chain.id,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    contract: { address: tabAddr, explorer: `${facts.explorerBase}/address/${tabAddr}`, deployedThisRun: !process.env.AGENT_TAB_ADDRESS?.trim() },
    tabId: tabId.toString(),
    addresses: { agent: agent.address, provider: provider.address },
    usdcMovedToProvider: { gasTopUp: usd(topUpSent), paidForCalls: usd(DRY ? 0n : PRICE * 5n) },
    balances: {
      agentBefore: usd(before.agent),
      agentAfter: usd(after.agent),
      providerBefore: usd(before.provider),
      providerAfter: usd(after.provider),
    },
    transactions: txs,
    notes,
  }
  say('\n================ Summary ================')
  say(`Mode:       ${summary.mode} on ${facts.name}`)
  say(`Contract:   ${tabAddr}  ${summary.contract.explorer}`)
  say(`USDC moved: ${usd(topUpSent)} gas top-up + ${usd(DRY ? 0n : PRICE * 5n)} paid for 5 calls (rest of the ${usd(DEPOSIT)} deposit refunded)`)
  say(`Agent:      ${usd(before.agent)} -> ${usd(after.agent)} USDC`)
  say(`Provider:   ${usd(before.provider)} -> ${usd(after.provider)} USDC`)
  for (const t of txs) say(`  ${t.step}\n    ${t.hash}\n    ${t.explorer}`)
  const out = path.resolve(HERE, '..', DRY ? 'mainnet-run.dry-run.json' : 'mainnet-run.json')
  fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n')
  say(`\nWritten to ${path.basename(out)}`)
}

main().catch((e: unknown) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
