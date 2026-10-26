// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AgentTab
/// @notice Prepaid, one-way USDC tabs settled with cumulative EIP-712 vouchers.
/// @dev Trust model: a provider must redeem before the client closes after expiry.
/// Expiry does not invalidate vouchers, but the client may close immediately then;
/// there is no redemption grace period. A client can recover unspent funds only
/// after expiry, unless the provider voluntarily closes early. No admin or upgrades.
/// Assumes the configured token is standard, non-fee-on-transfer USDC on Arc
/// (0x3600000000000000000000000000000000000000). Amounts use its 6-decimal units.
/// ERC-1271 voucher validity is evaluated at settlement time, not signing time.
contract AgentTab is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Tab {
        address client;
        address provider;
        uint256 deposit;
        uint256 paid;
        uint256 expiresAt;
        bool closed;
    }

    IERC20 public immutable usdc;
    uint256 public nextTabId = 1;
    mapping(uint256 => Tab) public tabs;
    mapping(address => uint256[]) private _tabsOf;

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(uint256 tabId,uint256 cumulativeAmount)");

    error ZeroAddress();
    error InvalidProvider();
    error InvalidAmount();
    error InvalidExpiry();
    error TabNotFound();
    error NotClient();
    error NotProvider();
    error TabAlreadyClosed();
    error TabExpired();
    error TabNotExpired();
    error InvalidSignature();
    error StaleVoucher();

    event TabOpened(
        uint256 indexed tabId,
        address indexed client,
        address indexed provider,
        uint256 amount,
        uint256 expiresAt
    );
    event ToppedUp(uint256 indexed tabId, uint256 amount, uint256 newDeposit);
    event Redeemed(uint256 indexed tabId, address indexed provider, uint256 amount, uint256 totalPaid);
    /// @param providerPaid Additional payout on closing, not lifetime payments.
    /// @param refunded Unspent deposit returned to the client.
    event TabClosed(uint256 indexed tabId, uint256 providerPaid, uint256 refunded);

    /// @param _usdc USDC ERC-20 token; amounts are denominated in base units.
    constructor(IERC20 _usdc) EIP712("AgentTab", "1") {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        usdc = _usdc;
    }

    /// @notice Open a funded tab; first approve this contract to spend USDC.
    /// @return tabId The new tab's identifier, starting at 1.
    function openTab(address provider, uint256 amount, uint256 expiresAt)
        external
        nonReentrant
        returns (uint256 tabId)
    {
        if (provider == address(0) || provider == msg.sender) revert InvalidProvider();
        if (amount == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        tabId = nextTabId++;
        tabs[tabId] = Tab(msg.sender, provider, amount, 0, expiresAt, false);
        _tabsOf[msg.sender].push(tabId);
        _tabsOf[provider].push(tabId);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit TabOpened(tabId, msg.sender, provider, amount, expiresAt);
    }

    /// @notice Increase a live tab's deposit without changing its expiry.
    function topUp(uint256 tabId, uint256 amount) external nonReentrant {
        Tab storage tab = _existingTab(tabId);
        if (msg.sender != tab.client) revert NotClient();
        if (tab.closed) revert TabAlreadyClosed();
        if (block.timestamp >= tab.expiresAt) revert TabExpired();
        if (amount == 0) revert InvalidAmount();

        tab.deposit += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit ToppedUp(tabId, amount, tab.deposit);
    }

    /// @notice Redeem a client-signed cumulative voucher, including after expiry.
    /// @dev Payout is capped at the deposit; the signature covers the original,
    /// uncapped cumulativeAmount. Old, zero and replayed vouchers revert.
    function redeem(uint256 tabId, uint256 cumulativeAmount, bytes calldata signature)
        external
        nonReentrant
    {
        Tab storage tab = _existingTab(tabId);
        if (msg.sender != tab.provider) revert NotProvider();
        if (tab.closed) revert TabAlreadyClosed();

        uint256 effective = _cappedAmount(cumulativeAmount, tab.deposit);
        if (effective <= tab.paid) revert StaleVoucher();
        _verifyVoucher(tab.client, tabId, cumulativeAmount, signature);

        uint256 payout = effective - tab.paid;
        tab.paid = effective;

        usdc.safeTransfer(tab.provider, payout);
        emit Redeemed(tabId, tab.provider, payout, effective);
    }

    /// @notice Client closes an expired tab and receives its unspent deposit.
    /// @dev Does not settle any outstanding off-chain vouchers.
    function closeTab(uint256 tabId) external nonReentrant {
        Tab storage tab = _existingTab(tabId);
        if (msg.sender != tab.client) revert NotClient();
        if (tab.closed) revert TabAlreadyClosed();
        if (block.timestamp < tab.expiresAt) revert TabNotExpired();

        uint256 refund = tab.deposit - tab.paid;
        tab.closed = true;

        if (refund != 0) usdc.safeTransfer(tab.client, refund);
        emit TabClosed(tabId, 0, refund);
    }

    /// @notice Provider closes at any time, optionally settling a final voucher.
    /// @dev No signature is required when the capped amount does not exceed paid.
    /// All unspent funds are immediately refunded to the client. All tab effects
    /// are committed before either token transfer.
    function closeTab(uint256 tabId, uint256 cumulativeAmount, bytes calldata signature)
        external
        nonReentrant
    {
        Tab storage tab = _existingTab(tabId);
        if (msg.sender != tab.provider) revert NotProvider();
        if (tab.closed) revert TabAlreadyClosed();

        uint256 effective = _cappedAmount(cumulativeAmount, tab.deposit);
        uint256 payout;
        if (effective > tab.paid) {
            _verifyVoucher(tab.client, tabId, cumulativeAmount, signature);
            payout = effective - tab.paid;
            tab.paid = effective;
        }
        uint256 refund = tab.deposit - tab.paid;
        tab.closed = true;

        if (payout != 0) {
            usdc.safeTransfer(tab.provider, payout);
            emit Redeemed(tabId, tab.provider, payout, tab.paid);
        }
        if (refund != 0) usdc.safeTransfer(tab.client, refund);
        emit TabClosed(tabId, payout, refund);
    }

    /// @notice Return an existing tab, including its final state after closure.
    function getTab(uint256 tabId) external view returns (Tab memory) {
        return _existingTab(tabId);
    }

    /// @notice All tab IDs where who is client or provider, including closed tabs.
    function tabsOf(address who) external view returns (uint256[] memory) {
        return _tabsOf[who];
    }

    /// @notice Full EIP-712 digest to sign for the given cumulative voucher.
    /// @dev Domain binds signatures to this contract, chain, name and version.
    function hashVoucher(uint256 tabId, uint256 cumulativeAmount) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, tabId, cumulativeAmount)));
    }

    /// @notice Current chain-aware EIP-712 domain separator.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _existingTab(uint256 tabId) private view returns (Tab storage tab) {
        tab = tabs[tabId];
        if (tab.client == address(0)) revert TabNotFound();
    }

    function _cappedAmount(uint256 cumulativeAmount, uint256 deposit) private pure returns (uint256) {
        return cumulativeAmount < deposit ? cumulativeAmount : deposit;
    }

    function _verifyVoucher(address client, uint256 tabId, uint256 cumulativeAmount, bytes calldata signature)
        private
        view
    {
        if (!SignatureChecker.isValidSignatureNow(client, hashVoucher(tabId, cumulativeAmount), signature)) {
            revert InvalidSignature();
        }
    }
}
