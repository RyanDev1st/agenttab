import { ConnectKitButton } from 'connectkit'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ExternalLink } from 'lucide-react'
import { addressUrl } from '@/config/networks'
import { usd } from '@/lib/format'
import { NetworkProvider, useNetwork } from '@/hooks/useNetwork'
import { TxProvider } from '@/hooks/useTx'
import { AgentPanel } from '@/components/AgentPanel'
import { ProviderPanel } from '@/components/ProviderPanel'
import { ActivityLog } from '@/components/ActivityLog'
import { NetworkBanner, NetworkSwitcher } from '@/components/NetworkControls'

function Balance() {
  const { address } = useAccount()
  const { network } = useNetwork()
  const { data } = useReadContract({
    address: network.usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: network.chainId,
    query: { enabled: !!address, refetchInterval: 5000 },
  })
  if (!address || data === undefined) return null
  return (
    <div className="hidden text-right sm:block">
      <div className="label">USDC balance</div>
      <div className="display text-lg font-bold tabular-nums">{usd(data)}</div>
    </div>
  )
}

function Body() {
  const { address } = useAccount()
  const { network } = useNetwork()
  // Re-mount the panels when the account or network changes so selection state never leaks across them.
  const scope = `${network.key}:${address ?? 'none'}`

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-24 pt-8 sm:pt-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-4xl font-bold sm:text-5xl">AgentTab</h1>
          <p className="mt-1 max-w-md text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            Prepaid USDC tabs on Arc. An agent signs a tiny voucher per API call, and the provider settles once.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <NetworkSwitcher />
          <Balance />
          <ConnectKitButton />
        </div>
      </header>

      <NetworkBanner />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <AgentPanel key={`agent:${scope}`} />
        <ProviderPanel key={`provider:${scope}`} />
      </div>

      <ActivityLog />

      <footer className="text-xs" style={{ color: 'var(--subtle)' }}>
        {network.configured && (
          <a
            href={addressUrl(network, network.agentTab)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            AgentTab contract on {network.label} <ExternalLink className="size-3" />
          </a>
        )}
      </footer>
    </main>
  )
}

export default function App() {
  return (
    <NetworkProvider>
      <TxProvider>
        <Body />
      </TxProvider>
    </NetworkProvider>
  )
}
