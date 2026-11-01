# AgentTab

Prepaid USDC tabs so an AI agent can pay an API per call on Arc, without sending one onchain payment per request. The agent deposits USDC into escrow for a provider, signs a tiny off-chain voucher for each call (no gas), and the provider settles the latest voucher onchain whenever it likes. Unspent funds go back to the agent.

Built with [Arc Studio](https://studio.arc.io)

Live app: https://ryandev1st.github.io/agenttab/

## Live on Arc Mainnet

- Contract: [`0x901512103E37AD05ce803AbCF1028a643D0C5838`](https://explorer.arc.io/address/0x901512103e37ad05ce803abcf1028a643d0c5838)
- Open a 0.10 USDC tab: [`0x6e98ee62...`](https://explorer.arc.io/tx/0x6e98ee6244cc50d3e994e40b9f14a3fa9690e1acc3f4eaa4ad924374aaf4209d)
- Redeem 0.03 USDC after three paid calls: [`0xc4624919...`](https://explorer.arc.io/tx/0xc46249195e4482e15d1e545d7afc6bb704d2ac266966651d79b24a2b09970602)
- Settle at 0.05 USDC, close early and refund 0.05 USDC: [`0xb2d59862...`](https://explorer.arc.io/tx/0xb2d598628b0e07421c6581db17d3edf3af5973156aa81f44f684b07bdcc4fe13)

Every transaction from the run is in `mainnet-run.json`. These are small demo amounts between two wallets owned by the builder, not customer payments.

## What you can do

- Switch between Arc Mainnet and Arc Testnet from the header. Mainnet is the default once its contract address is configured, otherwise the app opens on Testnet.
- Agent side: open a tab for a provider with a USDC deposit and expiry, simulate paid API calls (0.01 USDC each) with a running meter, top up, and refund after expiry.
- Provider side: see the latest voucher received for each tab, redeem it, or settle and close early.
- Every transaction links to the explorer of the network it ran on.

### Trying it with two accounts

The agent and the provider must be different addresses. Both live in the same wallet: use two accounts in your browser wallet, open the tab as the agent with the provider account's address, and use "Switch account" (or your wallet's own account menu) to move between the two roles. Both panels update when the connected account changes.

The "voucher inbox" is a demo stand-in for an HTTP 402 / payment header. In a real integration the API answers 402 with a price, the agent retries with its newest signed voucher in a payment header, and the provider keeps the latest one. Here the voucher is kept in the browser's localStorage so both accounts in the same browser can see it.

## Networks and configuration

All per-network settings live in `src/config/networks.ts`: the AgentTab address, the USDC address and the explorer. To use your own mainnet deployment, change `AGENT_TAB_MAINNET_ADDRESS`. If it is the zero address, mainnet transactions are disabled in the app.

## Tech stack

React, Vite, TypeScript, Tailwind CSS, wagmi, viem, ConnectKit. Solidity with Foundry for the contract.

## Development

Prerequisites: [Bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run dev
```

Environment variables for the app: none. (Deployment uses `PRIVATE_KEY`, see below.)

Other variables:

- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional outside Arc Studio, provisioned for backend RPC access.

Contract commands:

```bash
bun run contracts:build
bun run contracts:test
```

End-to-end check on Arc Testnet (two funded throwaway keys, never use mainnet keys):

```bash
RPC_URL=https://rpc.testnet.arc.io AGENT_KEY=0x... PROVIDER_KEY=0x... bun run scripts/e2e-flow.ts
```

Production build (static site with relative asset paths, so it works from any sub-path such as GitHub Pages):

```bash
npm run build      # or: bun run build
```

The output is in `dist/`. Publish that folder; no server or rewrite rules are needed.

## Mainnet demo run

`scripts/mainnet-demo.ts` runs the whole flow with small amounts on Arc Mainnet, using two keys that you supply and control. It is separate from the app and never runs automatically. Mainnet transactions use real USDC and cannot be undone, so rehearse with `--dry-run` first.

What it does, printing each transaction hash and its `explorer.arc.io` link:

1. Deploys AgentTab with the mainnet USDC address, unless `AGENT_TAB_ADDRESS` is set, in which case it uses that contract.
2. Sends the provider 0.20 USDC for gas if the provider holds less than 0.10 USDC.
3. The agent approves and opens a tab for the provider: 0.10 USDC, expiring in 1 hour.
4. The agent signs vouchers for 3 paid calls at 0.01 each, and the provider redeems 0.03.
5. The agent signs 2 more calls (0.05 in total), and the provider settles and closes early. The agent is refunded the rest (0.05).
6. Prints a summary and writes it to `mainnet-run.json`.

```bash
forge build   # creates contracts/out/AgentTab.sol/AgentTab.json, needed when the script deploys
export AGENT_KEY=0x...        # funded with at least 0.40 USDC on Arc Mainnet
export PROVIDER_KEY=0x...     # a different key; it can start empty
# export AGENT_TAB_ADDRESS=0x...   # optional: reuse an existing deployment

bun run scripts/mainnet-demo.ts --dry-run   # simulate only, sends nothing
bun run scripts/mainnet-demo.ts             # real run, asks you to type "mainnet" first (skip with --yes)
```

Notes:
- The script refuses to run if the agent holds less than 0.40 USDC, or if the RPC reports a different chain than expected.
- `--dry-run` estimates gas and runs `eth_call` for everything that can be checked against current chain state: the constructor, the gas transfer, the approval, opening a tab on an existing contract, and the voucher signatures and EIP-712 digest. Steps that need an earlier step to have landed (redeem and close need an open tab) are encoded and signed but cannot be simulated until then. A dry run writes `mainnet-run.dry-run.json`, not `mainnet-run.json`.
- The 0.20 USDC gas top-up and the gas paid by both keys are real costs. Gas is paid in USDC on Arc.
- Set `DEMO_NETWORK=testnet` to rehearse the same script on Arc Testnet.

## Deploy to Arc Mainnet

Mainnet transactions use real USDC and cannot be undone. Test on Arc Testnet first and get an independent professional audit before deploying. You deploy from your own wallet; nothing here deploys for you.

1. Install [Arc Foundry](https://docs.arc.io/arc/tutorials/install-arc-foundry.md) (`arc-forge`). Plain `forge` also works for this script.
2. Fund the deployer with USDC on Arc Mainnet. USDC is the gas token on Arc, so there is no separate gas coin. A testnet dry run estimated about 0.08 USDC for the deployment; check the estimate printed by your own dry run.
3. Export the deployer key (never commit it) and run a dry run, which broadcasts nothing:

```bash
export PRIVATE_KEY=0x...   # deployer key, kept out of shell history and source control

arc-forge script contracts/script/DeployAgentTab.s.sol:DeployAgentTab \
  --rpc-url https://rpc.mainnet.arc.io
```

4. Deploy (chain id 5042):

```bash
arc-forge script contracts/script/DeployAgentTab.s.sol:DeployAgentTab \
  --rpc-url https://rpc.mainnet.arc.io \
  --chain-id 5042 \
  --broadcast
```

The script picks the USDC address for the chain you point it at (the Arc USDC ERC-20, 6 decimals) and refuses to run on any other chain. Arc requires `maxFeePerGas` of at least 20 gwei; if a transaction sits pending, add `--with-gas-price 25gwei`.

5. Optional, verify the source. Arc's explorers run Blockscout; verification is documented for Testnet. If the mainnet explorer exposes the same API, run:

```bash
arc-forge verify-contract <DEPLOYED_ADDRESS> contracts/AgentTab.sol:AgentTab \
  --chain-id 5042 \
  --verifier blockscout \
  --verifier-url https://explorer.arc.io/api/ \
  --constructor-args $(arc-cast abi-encode "constructor(address)" 0x3600000000000000000000000000000000000000)
```

If that endpoint is not available, use the explorer's contract verification page instead. Use the same compiler settings as `foundry.toml` (solc 0.8.28, optimizer on with 200 runs, EVM cancun).

6. Put the deployed address into `AGENT_TAB_MAINNET_ADDRESS` in `src/config/networks.ts`. The app then defaults to Arc Mainnet.

Deploy to Arc Testnet the same way by swapping in `https://rpc.testnet.arc.io` and `--chain-id 5042002`.
