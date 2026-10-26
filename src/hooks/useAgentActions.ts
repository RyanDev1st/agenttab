import { useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { erc20Abi, parseEventLogs, type Address, type Hex } from 'viem'
import { toast } from 'sonner'
import { agentTabAbi } from '@/lib/agentTab'
import { useNetwork } from './useNetwork'
import { useTx } from './useTx'

/** All state-changing contract calls the app makes, each tracked in the activity log. */
export function useAgentActions() {
  const { address } = useAccount()
  const { network } = useNetwork()
  const AGENT_TAB_ADDRESS = network.agentTab
  const CHAIN_ID = network.chainId
  const USDC_ADDRESS = network.usdc
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const { exec } = useTx()
  const [busy, setBusy] = useState<string | null>(null)

  async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T> {
    setBusy(key)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }

  async function ensureAllowance(amount: bigint): Promise<boolean> {
    if (!address || !publicClient) return false
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, AGENT_TAB_ADDRESS],
    })
    if (allowance >= amount) return true
    const receipt = await exec('Approve USDC', () =>
      writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [AGENT_TAB_ADDRESS, amount],
        chainId: CHAIN_ID,
      }),
    )
    return !!receipt
  }

  const openTab = (provider: Address, amount: bigint, expiresAt: bigint) =>
    withBusy('open', async (): Promise<bigint | undefined> => {
      if (!(await ensureAllowance(amount))) return undefined
      const receipt = await exec('Open tab', () =>
        writeContractAsync({
          address: AGENT_TAB_ADDRESS,
          abi: agentTabAbi,
          functionName: 'openTab',
          args: [provider, amount, expiresAt],
          chainId: CHAIN_ID,
        }),
      )
      if (!receipt) return undefined
      const [opened] = parseEventLogs({ abi: agentTabAbi, eventName: 'TabOpened', logs: receipt.logs })
      toast.success('Tab opened.')
      return opened?.args.tabId
    })

  const topUp = (tabId: bigint, amount: bigint) =>
    withBusy(`topup-${tabId}`, async () => {
      if (!(await ensureAllowance(amount))) return false
      const receipt = await exec('Top up tab', () =>
        writeContractAsync({
          address: AGENT_TAB_ADDRESS,
          abi: agentTabAbi,
          functionName: 'topUp',
          args: [tabId, amount],
          chainId: CHAIN_ID,
        }),
      )
      if (receipt) toast.success('Tab topped up.')
      return !!receipt
    })

  const refund = (tabId: bigint) =>
    withBusy(`refund-${tabId}`, async () => {
      const receipt = await exec('Close tab and refund', () =>
        writeContractAsync({
          address: AGENT_TAB_ADDRESS,
          abi: agentTabAbi,
          functionName: 'closeTab',
          args: [tabId],
          chainId: CHAIN_ID,
        }),
      )
      if (receipt) toast.success('Tab closed. Unspent USDC refunded.')
      return !!receipt
    })

  const redeem = (tabId: bigint, cumulativeAmount: bigint, signature: Hex) =>
    withBusy(`redeem-${tabId}`, async () => {
      const receipt = await exec('Redeem voucher', () =>
        writeContractAsync({
          address: AGENT_TAB_ADDRESS,
          abi: agentTabAbi,
          functionName: 'redeem',
          args: [tabId, cumulativeAmount, signature],
          chainId: CHAIN_ID,
        }),
      )
      if (receipt) toast.success('Voucher redeemed.')
      return !!receipt
    })

  const settleAndClose = (tabId: bigint, cumulativeAmount: bigint, signature: Hex) =>
    withBusy(`settle-${tabId}`, async () => {
      const receipt = await exec('Settle and close tab', () =>
        writeContractAsync({
          address: AGENT_TAB_ADDRESS,
          abi: agentTabAbi,
          functionName: 'closeTab',
          args: [tabId, cumulativeAmount, signature],
          chainId: CHAIN_ID,
        }),
      )
      if (receipt) toast.success('Tab settled and closed. Remainder refunded to the agent.')
      return !!receipt
    })

  return { busy, openTab, topUp, refund, redeem, settleAndClose }
}
