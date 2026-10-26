import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Hex, TransactionReceipt } from 'viem'
import type { NetworkConfig } from '@/config/networks'
import { useNetwork } from './useNetwork'
import { parseError } from '@/lib/format'

export interface TxEntry {
  id: number
  label: string
  hash: Hex
  network: NetworkConfig
  status: 'pending' | 'success' | 'failed'
  at: number
}

interface TxContextValue {
  entries: TxEntry[]
  /** Switches chain if needed, sends the tx, tracks it, waits for the receipt. Returns the receipt, or undefined on failure. */
  exec: (label: string, send: () => Promise<Hex>) => Promise<TransactionReceipt | undefined>
}

const TxContext = createContext<TxContextValue | null>(null)

let nextId = 1

export function TxProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TxEntry[]>([])
  const { chainId } = useAccount()
  const { network } = useNetwork()
  const CHAIN_ID = network.chainId
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()

  const patch = useCallback((id: number, status: TxEntry['status']) => {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, status } : e)))
  }, [])

  const exec = useCallback<TxContextValue['exec']>(
    async (label, send) => {
      let id = 0
      try {
        if (!network.configured) throw new Error('AgentTab is not configured on this network')
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        const hash = await send()
        id = nextId++
        setEntries((list) => [{ id, label, hash, network, status: 'pending', at: Date.now() }, ...list])
        if (!publicClient) throw new Error('No RPC client')
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        patch(id, receipt.status === 'success' ? 'success' : 'failed')
        if (receipt.status !== 'success') {
          toast.error(`${label} failed onchain.`)
          return undefined
        }
        await queryClient.invalidateQueries()
        return receipt
      } catch (error) {
        if (id) patch(id, 'failed')
        const text = parseError(error)
        if (text) toast.error(text)
        return undefined
      }
    },
    [chainId, CHAIN_ID, network, switchChainAsync, publicClient, queryClient, patch],
  )

  const value = useMemo(() => ({ entries, exec }), [entries, exec])
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>
}

export function useTx(): TxContextValue {
  const ctx = useContext(TxContext)
  if (!ctx) throw new Error('useTx must be used inside TxProvider')
  return ctx
}
