import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_NETWORK, NETWORKS, type NetworkConfig, type NetworkKey } from '@/config/networks'

const STORAGE_KEY = 'agenttab:network'

interface NetworkContextValue {
  network: NetworkConfig
  setNetwork: (key: NetworkKey) => void
  /** EIP-712 domain for vouchers on the selected network. */
  voucherDomain: { name: 'AgentTab'; version: '1'; chainId: number; verifyingContract: `0x${string}` }
}

const NetworkContext = createContext<NetworkContextValue | null>(null)

function initialKey(): NetworkKey {
  const saved = localStorage.getItem(STORAGE_KEY)
  // Never restore a saved mainnet choice while mainnet is unconfigured.
  if (saved === 'testnet' || (saved === 'mainnet' && NETWORKS.mainnet.configured)) return saved
  return DEFAULT_NETWORK
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<NetworkKey>(initialKey)

  const setNetwork = useCallback((next: NetworkKey) => {
    localStorage.setItem(STORAGE_KEY, next)
    setKey(next)
  }, [])

  const value = useMemo<NetworkContextValue>(() => {
    const network = NETWORKS[key]
    return {
      network,
      setNetwork,
      voucherDomain: { name: 'AgentTab', version: '1', chainId: network.chainId, verifyingContract: network.agentTab },
    }
  }, [key, setNetwork])

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used inside NetworkProvider')
  return ctx
}
