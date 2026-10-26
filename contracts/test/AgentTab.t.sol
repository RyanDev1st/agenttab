// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentTab} from "../AgentTab.sol";

/// Simple 6-decimal mock USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract AgentTabBase is Test {
    AgentTab internal tab;
    MockUSDC internal usdc;

    uint256 internal clientPk;
    address internal client;
    address internal provider = makeAddr("provider");
    address internal other = makeAddr("other");

    uint256 internal constant DEP = 1_000e6;
    uint256 internal expiry;

    function _deployToken() internal virtual returns (MockUSDC) {
        return new MockUSDC();
    }

    function setUp() public virtual {
        vm.warp(1_000_000);
        (client, clientPk) = makeAddrAndKey("client");
        usdc = _deployToken();
        tab = new AgentTab(IERC20(address(usdc)));
        usdc.mint(client, 10_000e6);
        vm.prank(client);
        usdc.approve(address(tab), type(uint256).max);
        expiry = block.timestamp + 7 days;
    }

    function _open() internal returns (uint256 id) {
        vm.prank(client);
        id = tab.openTab(provider, DEP, expiry);
    }

    function _sign(uint256 pk, uint256 id, uint256 amt) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, tab.hashVoucher(id, amt));
        return abi.encodePacked(r, s, v);
    }

    function _voucher(uint256 id, uint256 amt) internal view returns (bytes memory) {
        return _sign(clientPk, id, amt);
    }

    function _redeem(uint256 id, uint256 amt) internal {
        bytes memory sig = _voucher(id, amt);
        vm.prank(provider);
        tab.redeem(id, amt, sig);
    }
}

contract AgentTabTest is AgentTabBase {
    // ---------------------------------------------------------------- constructor
    function test_Constructor() public view {
        assertEq(address(tab.usdc()), address(usdc));
        assertEq(tab.nextTabId(), 1);
        assertEq(tab.DOMAIN_SEPARATOR().length, 32);
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(AgentTab.ZeroAddress.selector);
        new AgentTab(IERC20(address(0)));
    }

    // ---------------------------------------------------------------- openTab
    function test_OpenTab_StoresStateAndPullsFunds() public {
        uint256 id = _open();
        assertEq(id, 1);
        assertEq(tab.nextTabId(), 2);
        AgentTab.Tab memory t = tab.getTab(id);
        assertEq(t.client, client);
        assertEq(t.provider, provider);
        assertEq(t.deposit, DEP);
        assertEq(t.paid, 0);
        assertEq(t.expiresAt, expiry);
        assertFalse(t.closed);
        assertEq(usdc.balanceOf(address(tab)), DEP);
        assertEq(usdc.balanceOf(client), 10_000e6 - DEP);
    }

    function test_OpenTab_EmitsTabOpened() public {
        vm.expectEmit(true, true, true, true, address(tab));
        emit AgentTab.TabOpened(1, client, provider, DEP, expiry);
        _open();
    }

    function test_OpenTab_RevertsZeroProvider() public {
        vm.prank(client);
        vm.expectRevert(AgentTab.InvalidProvider.selector);
        tab.openTab(address(0), DEP, expiry);
    }

    function test_OpenTab_RevertsSelfProvider() public {
        vm.prank(client);
        vm.expectRevert(AgentTab.InvalidProvider.selector);
        tab.openTab(client, DEP, expiry);
    }

    function test_OpenTab_RevertsZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(AgentTab.InvalidAmount.selector);
        tab.openTab(provider, 0, expiry);
    }

    function test_OpenTab_RevertsPastOrCurrentExpiry() public {
        vm.startPrank(client);
        vm.expectRevert(AgentTab.InvalidExpiry.selector);
        tab.openTab(provider, DEP, block.timestamp);
        vm.expectRevert(AgentTab.InvalidExpiry.selector);
        tab.openTab(provider, DEP, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_OpenTab_RevertsWithoutAllowance() public {
        vm.prank(other);
        vm.expectRevert();
        tab.openTab(provider, DEP, expiry);
    }

    // ---------------------------------------------------------------- topUp
    function test_TopUp_IncreasesDepositAndEmits() public {
        uint256 id = _open();
        vm.expectEmit(true, false, false, true, address(tab));
        emit AgentTab.ToppedUp(id, 500e6, DEP + 500e6);
        vm.prank(client);
        tab.topUp(id, 500e6);
        AgentTab.Tab memory t = tab.getTab(id);
        assertEq(t.deposit, DEP + 500e6);
        assertEq(t.expiresAt, expiry);
        assertEq(usdc.balanceOf(address(tab)), DEP + 500e6);
    }

    function test_TopUp_RevertsNonClient() public {
        uint256 id = _open();
        vm.prank(other);
        vm.expectRevert(AgentTab.NotClient.selector);
        tab.topUp(id, 1);
        vm.prank(provider);
        vm.expectRevert(AgentTab.NotClient.selector);
        tab.topUp(id, 1);
    }

    function test_TopUp_RevertsUnknownTab() public {
        vm.prank(client);
        vm.expectRevert(AgentTab.TabNotFound.selector);
        tab.topUp(42, 1);
    }

    function test_TopUp_RevertsZeroAmount() public {
        uint256 id = _open();
        vm.prank(client);
        vm.expectRevert(AgentTab.InvalidAmount.selector);
        tab.topUp(id, 0);
    }

    function test_TopUp_RevertsAtOrAfterExpiry() public {
        uint256 id = _open();
        vm.warp(expiry);
        vm.prank(client);
        vm.expectRevert(AgentTab.TabExpired.selector);
        tab.topUp(id, 1);
    }

    function test_TopUp_RevertsWhenClosed() public {
        uint256 id = _open();
        vm.prank(provider);
        tab.closeTab(id, 0, "");
        vm.prank(client);
        vm.expectRevert(AgentTab.TabAlreadyClosed.selector);
        tab.topUp(id, 1);
    }

    function test_TopUp_ThenRedeemMoreThanOriginalDeposit() public {
        uint256 id = _open();
        _redeem(id, DEP); // drain original deposit
        vm.prank(client);
        tab.topUp(id, 400e6);
        _redeem(id, DEP + 300e6);
        assertEq(usdc.balanceOf(provider), DEP + 300e6);
        assertEq(tab.getTab(id).paid, DEP + 300e6);
        assertEq(usdc.balanceOf(address(tab)), 100e6);
    }

    // ---------------------------------------------------------------- redeem
    function test_Redeem_HappyPathThenClose() public {
        uint256 id = _open();
        vm.expectEmit(true, true, false, true, address(tab));
        emit AgentTab.Redeemed(id, provider, 300e6, 300e6);
        _redeem(id, 300e6);
        assertEq(usdc.balanceOf(provider), 300e6);
        assertEq(tab.getTab(id).paid, 300e6);

        vm.warp(expiry);
        vm.expectEmit(true, false, false, true, address(tab));
        emit AgentTab.TabClosed(id, 0, DEP - 300e6);
        vm.prank(client);
        tab.closeTab(id);
        assertEq(usdc.balanceOf(client), 10_000e6 - 300e6);
        assertEq(usdc.balanceOf(address(tab)), 0);
        assertTrue(tab.getTab(id).closed);
    }

    function test_Redeem_PartialThenMoreIsCumulative() public {
        uint256 id = _open();
        _redeem(id, 200e6);
        assertEq(usdc.balanceOf(provider), 200e6);

        vm.expectEmit(true, true, false, true, address(tab));
        emit AgentTab.Redeemed(id, provider, 300e6, 500e6);
        _redeem(id, 500e6);
        assertEq(usdc.balanceOf(provider), 500e6);
        assertEq(tab.getTab(id).paid, 500e6);
        assertEq(usdc.balanceOf(address(tab)), DEP - 500e6);
    }

    function test_Redeem_ReplaySameVoucherReverts() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, 300e6);
        vm.prank(provider);
        tab.redeem(id, 300e6, sig);
        vm.prank(provider);
        vm.expectRevert(AgentTab.StaleVoucher.selector);
        tab.redeem(id, 300e6, sig);
        assertEq(usdc.balanceOf(provider), 300e6);
    }

    function test_Redeem_OlderVoucherReverts() public {
        uint256 id = _open();
        bytes memory older = _voucher(id, 200e6);
        _redeem(id, 500e6);
        vm.prank(provider);
        vm.expectRevert(AgentTab.StaleVoucher.selector);
        tab.redeem(id, 200e6, older);
    }

    function test_Redeem_ZeroVoucherReverts() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, 0);
        vm.prank(provider);
        vm.expectRevert(AgentTab.StaleVoucher.selector);
        tab.redeem(id, 0, sig);
    }

    function test_Redeem_WrongSignerReverts() public {
        uint256 id = _open();
        (, uint256 malloryPk) = makeAddrAndKey("mallory");
        bytes memory bad = _sign(malloryPk, id, 300e6);
        vm.prank(provider);
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.redeem(id, 300e6, bad);
    }

    function test_Redeem_TamperedAmountOrTabIdReverts() public {
        uint256 id = _open();
        vm.prank(client);
        uint256 id2 = tab.openTab(provider, DEP, expiry);
        bytes memory sig = _voucher(id, 100e6);
        vm.startPrank(provider);
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.redeem(id, 200e6, sig); // amount changed
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.redeem(id2, 100e6, sig); // voucher for a different tab
        vm.stopPrank();
    }

    function test_Redeem_MalformedSignatureReverts() public {
        uint256 id = _open();
        vm.prank(provider);
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.redeem(id, 100e6, hex"1234");
    }

    function test_Redeem_OverDepositIsCappedAtDeposit() public {
        uint256 id = _open();
        _redeem(id, DEP * 5);
        assertEq(usdc.balanceOf(provider), DEP);
        assertEq(tab.getTab(id).paid, DEP);
        assertEq(usdc.balanceOf(address(tab)), 0);
        // fully paid; same voucher again is stale
        bytes memory sig = _voucher(id, DEP * 5);
        vm.prank(provider);
        vm.expectRevert(AgentTab.StaleVoucher.selector);
        tab.redeem(id, DEP * 5, sig);
    }

    /// Documents behaviour: an over-deposit voucher stays valid for later top-ups
    /// because the signature covers the uncapped amount (by design, see contract natspec).
    function test_Redeem_CappedVoucherCoversLaterTopUp() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, DEP * 2);
        vm.prank(provider);
        tab.redeem(id, DEP * 2, sig);
        vm.prank(client);
        tab.topUp(id, 300e6);
        vm.prank(provider);
        tab.redeem(id, DEP * 2, sig);
        assertEq(usdc.balanceOf(provider), DEP + 300e6);
    }

    function test_Redeem_RevertsNonProvider() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, 100e6);
        vm.prank(other);
        vm.expectRevert(AgentTab.NotProvider.selector);
        tab.redeem(id, 100e6, sig);
        vm.prank(client);
        vm.expectRevert(AgentTab.NotProvider.selector);
        tab.redeem(id, 100e6, sig);
    }

    function test_Redeem_RevertsUnknownTab() public {
        vm.prank(provider);
        vm.expectRevert(AgentTab.TabNotFound.selector);
        tab.redeem(7, 1, "");
    }

    function test_Redeem_RevertsAfterClosed() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, 100e6);
        vm.prank(provider);
        tab.closeTab(id, 0, "");
        vm.prank(provider);
        vm.expectRevert(AgentTab.TabAlreadyClosed.selector);
        tab.redeem(id, 100e6, sig);
    }

    function test_Redeem_StillWorksAfterExpiry() public {
        uint256 id = _open();
        vm.warp(expiry + 1 days);
        _redeem(id, 250e6);
        assertEq(usdc.balanceOf(provider), 250e6);
    }

    // ---------------------------------------------------------------- client closeTab
    function test_ClientClose_RevertsBeforeExpiry() public {
        uint256 id = _open();
        vm.warp(expiry - 1);
        vm.prank(client);
        vm.expectRevert(AgentTab.TabNotExpired.selector);
        tab.closeTab(id);
    }

    function test_ClientClose_RefundsAfterExpiry() public {
        uint256 id = _open();
        vm.warp(expiry);
        vm.prank(client);
        tab.closeTab(id);
        assertEq(usdc.balanceOf(client), 10_000e6);
        assertEq(usdc.balanceOf(address(tab)), 0);
        assertTrue(tab.getTab(id).closed);
    }

    function test_ClientClose_FullyPaidRefundsZero() public {
        uint256 id = _open();
        _redeem(id, DEP);
        vm.warp(expiry);
        vm.expectEmit(true, false, false, true, address(tab));
        emit AgentTab.TabClosed(id, 0, 0);
        vm.prank(client);
        tab.closeTab(id);
        assertTrue(tab.getTab(id).closed);
    }

    function test_ClientClose_RevertsNonClient() public {
        uint256 id = _open();
        vm.warp(expiry);
        vm.prank(other);
        vm.expectRevert(AgentTab.NotClient.selector);
        tab.closeTab(id);
        vm.prank(provider);
        vm.expectRevert(AgentTab.NotClient.selector);
        tab.closeTab(id);
    }

    function test_ClientClose_RevertsTwiceAndUnknown() public {
        uint256 id = _open();
        vm.warp(expiry);
        vm.startPrank(client);
        tab.closeTab(id);
        vm.expectRevert(AgentTab.TabAlreadyClosed.selector);
        tab.closeTab(id);
        vm.expectRevert(AgentTab.TabNotFound.selector);
        tab.closeTab(99);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- provider closeTab
    function test_ProviderClose_EarlyWithFinalVoucherSettlesAndRefunds() public {
        uint256 id = _open();
        _redeem(id, 100e6);
        bytes memory sig = _voucher(id, 400e6);

        vm.expectEmit(true, true, false, true, address(tab));
        emit AgentTab.Redeemed(id, provider, 300e6, 400e6);
        vm.expectEmit(true, false, false, true, address(tab));
        emit AgentTab.TabClosed(id, 300e6, 600e6);
        vm.prank(provider);
        tab.closeTab(id, 400e6, sig);

        assertEq(usdc.balanceOf(provider), 400e6);
        assertEq(usdc.balanceOf(client), 10_000e6 - 400e6);
        assertEq(usdc.balanceOf(address(tab)), 0);
        AgentTab.Tab memory t = tab.getTab(id);
        assertTrue(t.closed);
        assertEq(t.paid, 400e6);
    }

    function test_ProviderClose_NoNewVoucherJustRefunds() public {
        uint256 id = _open();
        _redeem(id, 300e6);
        vm.expectEmit(true, false, false, true, address(tab));
        emit AgentTab.TabClosed(id, 0, 700e6);
        vm.prank(provider);
        tab.closeTab(id, 100e6, ""); // cumulative <= paid → no signature needed
        assertEq(usdc.balanceOf(provider), 300e6);
        assertEq(usdc.balanceOf(client), 10_000e6 - 300e6);
        assertEq(usdc.balanceOf(address(tab)), 0);
    }

    function test_ProviderClose_CapsOverDepositVoucher() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, DEP * 3);
        vm.prank(provider);
        tab.closeTab(id, DEP * 3, sig);
        assertEq(usdc.balanceOf(provider), DEP);
        assertEq(usdc.balanceOf(client), 10_000e6 - DEP);
        assertEq(usdc.balanceOf(address(tab)), 0);
    }

    function test_ProviderClose_RevertsInvalidSignatureWhenNewAmount() public {
        uint256 id = _open();
        (, uint256 malloryPk) = makeAddrAndKey("mallory");
        bytes memory bad = _sign(malloryPk, id, 300e6);
        vm.prank(provider);
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.closeTab(id, 300e6, bad);
        vm.prank(provider);
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.closeTab(id, 300e6, "");
    }

    function test_ProviderClose_RevertsNonProvider() public {
        uint256 id = _open();
        vm.prank(other);
        vm.expectRevert(AgentTab.NotProvider.selector);
        tab.closeTab(id, 0, "");
        vm.prank(client);
        vm.expectRevert(AgentTab.NotProvider.selector);
        tab.closeTab(id, 0, "");
    }

    function test_ProviderClose_RevertsClosedAndUnknown() public {
        uint256 id = _open();
        vm.startPrank(provider);
        tab.closeTab(id, 0, "");
        vm.expectRevert(AgentTab.TabAlreadyClosed.selector);
        tab.closeTab(id, 0, "");
        vm.expectRevert(AgentTab.TabNotFound.selector);
        tab.closeTab(55, 0, "");
        vm.stopPrank();
    }

    function test_ClientCloseAfterProviderCloseReverts() public {
        uint256 id = _open();
        vm.prank(provider);
        tab.closeTab(id, 0, "");
        vm.warp(expiry);
        vm.prank(client);
        vm.expectRevert(AgentTab.TabAlreadyClosed.selector);
        tab.closeTab(id);
    }

    // ---------------------------------------------------------------- views
    function test_GetTab_UnknownReverts() public {
        vm.expectRevert(AgentTab.TabNotFound.selector);
        tab.getTab(1);
        vm.expectRevert(AgentTab.TabNotFound.selector);
        tab.getTab(0);
    }

    function test_TabsOf_ClientAndProvider() public {
        assertEq(tab.tabsOf(client).length, 0);
        uint256 a = _open();
        vm.prank(client);
        uint256 b = tab.openTab(other, DEP, expiry);
        vm.prank(other);
        usdc.approve(address(tab), type(uint256).max);
        usdc.mint(other, DEP);
        vm.prank(other);
        uint256 c = tab.openTab(provider, DEP, expiry);

        uint256[] memory cl = tab.tabsOf(client);
        assertEq(cl.length, 2);
        assertEq(cl[0], a);
        assertEq(cl[1], b);
        uint256[] memory pr = tab.tabsOf(provider);
        assertEq(pr.length, 2);
        assertEq(pr[0], a);
        assertEq(pr[1], c);
        uint256[] memory ot = tab.tabsOf(other);
        assertEq(ot.length, 2);
        assertEq(ot[0], b);
        assertEq(ot[1], c);
        assertEq(tab.tabsOf(makeAddr("nobody")).length, 0);
    }

    function test_TabsOf_IncludesClosedTabs() public {
        uint256 id = _open();
        vm.prank(provider);
        tab.closeTab(id, 0, "");
        assertEq(tab.tabsOf(client).length, 1);
        assertEq(tab.tabsOf(provider).length, 1);
    }

    function test_HashVoucher_MatchesEip712Digest() public view {
        bytes32 structHash = keccak256(abi.encode(tab.VOUCHER_TYPEHASH(), uint256(3), uint256(77)));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", tab.DOMAIN_SEPARATOR(), structHash));
        assertEq(tab.hashVoucher(3, 77), expected);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentTab"),
                keccak256("1"),
                block.chainid,
                address(tab)
            )
        );
        assertEq(tab.DOMAIN_SEPARATOR(), domain);
    }

    function test_Voucher_NotValidOnOtherDeployment() public {
        AgentTab tab2 = new AgentTab(IERC20(address(usdc)));
        assertTrue(tab2.hashVoucher(1, 1) != tab.hashVoucher(1, 1));
    }
}
