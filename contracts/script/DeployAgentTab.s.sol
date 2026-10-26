// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentTab} from "../AgentTab.sol";

/// @notice Deploys AgentTab with the USDC ERC-20 of the chain you point `--rpc-url` at.
/// @dev Reads the deployer key from the PRIVATE_KEY env var (hex, 0x-prefixed).
///      Supported chains: Arc Mainnet (5042) and Arc Testnet (5042002).
///      USDC is the same predeploy address on both. The script reverts on any other chain
///      so a wrong --rpc-url can never deploy against the wrong token.
contract DeployAgentTab is Script {
    uint256 internal constant ARC_MAINNET = 5042;
    uint256 internal constant ARC_TESTNET = 5042002;

    /// @dev Arc USDC ERC-20 predeploy (6 decimals).
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    error UnsupportedChain(uint256 chainId);
    error NoUsdcCode(address usdc);

    function usdcFor(uint256 chainId) public pure returns (address) {
        if (chainId == ARC_MAINNET || chainId == ARC_TESTNET) return ARC_USDC;
        revert UnsupportedChain(chainId);
    }

    function run() external returns (AgentTab tab) {
        address usdc = usdcFor(block.chainid);
        if (usdc.code.length == 0) revert NoUsdcCode(usdc);

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        console2.log("Chain id:", block.chainid);
        console2.log("Deployer:", vm.addr(deployerKey));
        console2.log("USDC:", usdc);

        vm.startBroadcast(deployerKey);
        tab = new AgentTab(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("AgentTab deployed at:", address(tab));
    }
}
