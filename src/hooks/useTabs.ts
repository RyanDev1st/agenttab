import { useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { agentTabAbi, type Tab } from '@/lib/agentTab'
import { useNetwork } from './useNetwork'

/** Every tab where `address` is the client or the provider, newest first, kept fresh by polling. */
export function useTabs(address: Address | undefined) {
  const { network } = useNetwork()
  const AGENT_TAB_ADDRESS = network.agentTab
  const CHAIN_ID = network.chainId
  const ids = useReadContract({
    address: AGENT_TAB_ADDRESS,
    abi: agentTabAbi,
    functionName: 'tabsOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && network.configured, refetchInterval: 5000 },
  })

  const tabIds = useMemo(() => [...(ids.data ?? [])].reverse(), [ids.data])

  const tabs = useReadContracts({
    contracts: tabIds.map((id) => ({
      address: AGENT_TAB_ADDRESS,
      abi: agentTabAbi,
      functionName: 'getTab' as const,
      args: [id] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: tabIds.length > 0 && network.configured, refetchInterval: 5000 },
  })

  const list = useMemo<Tab[]>(() => {
    const out: Tab[] = []
    tabIds.forEach((id, i) => {
      const result = tabs.data?.[i]
      if (result?.status === 'success') out.push({ id, ...result.result })
    })
    return out
  }, [tabIds, tabs.data])

  return { tabs: list, isLoading: ids.isLoading || (tabIds.length > 0 && tabs.isLoading) }
}
