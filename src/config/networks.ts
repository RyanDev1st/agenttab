import type { Address } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { requireChain, getUsdc } from '@/onchain-facts'

/**
 * Single source of truth for per-network settings: the AgentTab contract address,
 * the USDC address and the explorer. Chain IDs, USDC and explorer URLs come from
 * the generated onchain-facts module; only the AgentTab addresses live here.
 */

export type NetworkKey = 'mainnet' | 'testnet'
type ArcChain = typeof arc | typeof arcTestnet

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/**
 * >>> TODO (MAINNET): replace this placeholder with your deployed AgentTab address on Arc Mainnet. <<<
 * While it is the zero address, the app treats Arc Mainnet as "not configured",
 * defaults to Arc Testnet, and blocks mainnet transactions.
 */
export const AGENT_TAB_MAINNET_ADDRESS: Address = ZERO_ADDRESS

/** Deployed on Arc Testnet by Arc Studio. */
export const AGENT_TAB_TESTNET_ADDRESS: Address = '0xe2f9d4a4a498bee2df6f9ed25ba31ff96094e378'

export interface NetworkConfig {
  key: NetworkKey
  label: string
  chain: ArcChain
  chainId: ArcChain['id']
  agentTab: Address
  /** False while the AgentTab address is still the placeholder. */
  configured: boolean
  usdc: Address
  usdcDecimals: number
  explorerBase: string
  isTestnet: boolean
}

function build(key: NetworkKey, chain: ArcChain, agentTab: Address, label: string): NetworkConfig {
  const facts = requireChain(chain.id)
  const usdc = getUsdc(chain.id)
  if (!usdc) throw new Error(`USDC missing for chain ${chain.id} in the onchain facts registry`)
  return {
    key,
    label,
    chain,
    chainId: chain.id,
    agentTab,
    configured: agentTab.toLowerCase() !== ZERO_ADDRESS,
    usdc: usdc.address as Address,
    usdcDecimals: usdc.decimals,
    explorerBase: facts.explorerBase,
    isTestnet: facts.isTestnet,
  }
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  mainnet: build('mainnet', arc, AGENT_TAB_MAINNET_ADDRESS, 'Arc Mainnet'),
  testnet: build('testnet', arcTestnet, AGENT_TAB_TESTNET_ADDRESS, 'Arc Testnet'),
}

export const NETWORK_LIST: NetworkConfig[] = [NETWORKS.mainnet, NETWORKS.testnet]

/** Arc Mainnet once its address is configured, otherwise Arc Testnet. */
export const DEFAULT_NETWORK: NetworkKey = NETWORKS.mainnet.configured ? 'mainnet' : 'testnet'

export const txUrl = (n: NetworkConfig, hash: string) => `${n.explorerBase}/tx/${hash}`
export const addressUrl = (n: NetworkConfig, address: string) => `${n.explorerBase}/address/${address}`
