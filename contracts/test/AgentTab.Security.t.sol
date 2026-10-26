// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentTab} from "../AgentTab.sol";
import {MockUSDC, AgentTabBase} from "./AgentTab.t.sol";

/// Token that, when `trigger` is the `from` of a transfer, makes a re-entrant call into `target`.
contract ReentrantToken is MockUSDC {
    address public target;
    address public trigger;
    bytes public data;
    bool public attempted;
    bool public innerOk;
    bytes public innerRet;

    function arm(address _target, address _trigger, bytes calldata _data) external {
        target = _target;
        trigger = _trigger;
        data = _data;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (trigger != address(0) && from == trigger && !attempted) {
            attempted = true;
            (innerOk, innerRet) = target.call(data);
        }
        super._update(from, to, value);
    }
}

contract AgentTabReentrancyTest is AgentTabBase {
    ReentrantToken internal rt;

    function _deployToken() internal override returns (MockUSDC) {
        rt = new ReentrantToken();
        return rt;
    }

    function _assertBlocked() internal view {
        assertTrue(rt.attempted(), "hook not hit");
        assertFalse(rt.innerOk(), "re-entry succeeded");
        assertEq(bytes4(rt.innerRet()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_Reentrancy_RedeemPayoutCannotReenterRedeem() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, 600e6);
        rt.arm(address(tab), address(tab), abi.encodeCall(AgentTab.redeem, (id, 600e6, sig)));
        vm.prank(provider);
        tab.redeem(id, 600e6, sig);
        _assertBlocked();
        assertEq(usdc.balanceOf(provider), 600e6);
        assertEq(tab.getTab(id).paid, 600e6);
        assertEq(usdc.balanceOf(address(tab)), DEP - 600e6);
    }

    function test_Reentrancy_ProviderCloseCannotReenterClose() public {
        uint256 id = _open();
        bytes memory sig = _voucher(id, 400e6);
        rt.arm(address(tab), address(tab), abi.encodeWithSignature("closeTab(uint256,uint256,bytes)", id, 400e6, sig));
        vm.prank(provider);
        tab.closeTab(id, 400e6, sig);
        _assertBlocked();
        assertEq(usdc.balanceOf(provider), 400e6);
        assertEq(usdc.balanceOf(client), 10_000e6 - 400e6);
        assertEq(usdc.balanceOf(address(tab)), 0);
    }

    function test_Reentrancy_ClientRefundCannotReenterClose() public {
        uint256 id = _open();
        vm.warp(expiry);
        rt.arm(address(tab), address(tab), abi.encodeWithSignature("closeTab(uint256)", id));
        vm.prank(client);
        tab.closeTab(id);
        _assertBlocked();
        assertEq(usdc.balanceOf(client), 10_000e6);
        assertEq(usdc.balanceOf(address(tab)), 0);
    }

    function test_Reentrancy_OpenTabPullCannotReenterOpen() public {
        rt.arm(address(tab), client, abi.encodeCall(AgentTab.openTab, (provider, DEP, expiry)));
        vm.prank(client);
        tab.openTab(provider, DEP, expiry);
        _assertBlocked();
        assertEq(tab.nextTabId(), 2);
        assertEq(usdc.balanceOf(address(tab)), DEP);
    }

    function test_Reentrancy_TopUpPullCannotReenterTopUp() public {
        uint256 id = _open();
        rt.arm(address(tab), client, abi.encodeCall(AgentTab.topUp, (id, 1e6)));
        vm.prank(client);
        tab.topUp(id, 100e6);
        _assertBlocked();
        assertEq(tab.getTab(id).deposit, DEP + 100e6);
        assertEq(usdc.balanceOf(address(tab)), DEP + 100e6);
    }
}

contract AgentTabFuzzTest is AgentTabBase {
    /// open → redeem(v1) → provider close(v2): all funds accounted for, nothing exceeds deposit.
    function testFuzz_ProviderFlowConservesFunds(uint256 dep, uint256 v1, uint256 v2) public {
        dep = bound(dep, 1, 5_000e6);
        v1 = bound(v1, 0, 10_000e6);
        v2 = bound(v2, 0, 10_000e6);
        vm.prank(client);
        uint256 id = tab.openTab(provider, dep, expiry);

        uint256 expectPaid;
        if (v1 > 0) {
            bytes memory s1 = _voucher(id, v1);
            vm.prank(provider);
            tab.redeem(id, v1, s1);
            expectPaid = v1 < dep ? v1 : dep;
            assertEq(tab.getTab(id).paid, expectPaid);
            assertEq(usdc.balanceOf(address(tab)), dep - expectPaid);
        }
        uint256 cap2 = v2 < dep ? v2 : dep;
        if (cap2 > expectPaid) expectPaid = cap2;
        bytes memory s2 = _voucher(id, v2);
        vm.prank(provider);
        tab.closeTab(id, v2, s2);

        AgentTab.Tab memory t = tab.getTab(id);
        assertEq(t.paid, expectPaid);
        assertLe(t.paid, dep);
        assertEq(usdc.balanceOf(provider), t.paid);
        assertEq(usdc.balanceOf(client), 10_000e6 - t.paid);
        assertEq(usdc.balanceOf(address(tab)), 0);
    }

    /// open → topUp → redeem → client close after expiry.
    function testFuzz_ClientFlowConservesFunds(uint256 dep, uint256 extra, uint256 v) public {
        dep = bound(dep, 1, 4_000e6);
        extra = bound(extra, 0, 4_000e6);
        v = bound(v, 0, 10_000e6);
        vm.prank(client);
        uint256 id = tab.openTab(provider, dep, expiry);
        if (extra > 0) {
            vm.prank(client);
            tab.topUp(id, extra);
        }
        uint256 total = dep + extra;
        uint256 expectPaid = v < total ? v : total;
        if (v > 0) _redeem(id, v);

        vm.warp(expiry);
        vm.prank(client);
        tab.closeTab(id);

        assertEq(usdc.balanceOf(provider), expectPaid);
        assertEq(usdc.balanceOf(client), 10_000e6 - expectPaid);
        assertEq(usdc.balanceOf(address(tab)), 0);
        assertEq(usdc.balanceOf(provider) + usdc.balanceOf(client), 10_000e6);
    }

    /// Cumulative vouchers: any increasing sequence pays out exactly the final capped value.
    function testFuzz_CumulativeVouchersPayExactlyFinal(uint256 a, uint256 b, uint256 c) public {
        uint256 id = _open();
        a = bound(a, 1, DEP / 2);
        b = bound(b, a + 1, DEP - 1);
        c = bound(c, b + 1, DEP * 3);
        _redeem(id, a);
        _redeem(id, b);
        uint256 capB = b < DEP ? b : DEP;
        assertEq(usdc.balanceOf(provider), capB);
        if (capB < DEP) {
            _redeem(id, c);
            assertEq(usdc.balanceOf(provider), c < DEP ? c : DEP);
        }
        assertEq(usdc.balanceOf(address(tab)), DEP - usdc.balanceOf(provider));
    }

    /// A signature from anyone but the client never redeems.
    function testFuzz_ForeignSignerNeverRedeems(uint256 pk, uint256 amt) public {
        pk = bound(pk, 1, type(uint128).max);
        vm.assume(pk != clientPk);
        amt = bound(amt, 1, DEP);
        uint256 id = _open();
        bytes memory bad = _sign(pk, id, amt);
        vm.prank(provider);
        vm.expectRevert(AgentTab.InvalidSignature.selector);
        tab.redeem(id, amt, bad);
    }

    /// Client cannot close early at any time before expiry.
    function testFuzz_ClientCannotCloseBeforeExpiry(uint256 dt) public {
        uint256 id = _open();
        dt = bound(dt, 0, 7 days - 1);
        vm.warp(block.timestamp + dt);
        vm.prank(client);
        vm.expectRevert(AgentTab.TabNotExpired.selector);
        tab.closeTab(id);
    }
}

contract AgentTabHandler is Test {
    AgentTab public tab;
    MockUSDC public usdc;
    uint256 public clientPk;
    address public client;
    address public provider1 = address(0xA11CE);
    address public provider2 = address(0xB0B);
    uint256 public totalMinted;

    constructor(AgentTab _tab, MockUSDC _usdc, uint256 _pk, address _client) {
        tab = _tab;
        usdc = _usdc;
        clientPk = _pk;
        client = _client;
        vm.prank(client);
        usdc.approve(address(tab), type(uint256).max);
    }

    function _prov(uint256 seed) internal view returns (address) {
        return seed % 2 == 0 ? provider1 : provider2;
    }

    function _pickTab(uint256 seed) internal view returns (bool ok, uint256 id) {
        uint256 n = tab.nextTabId();
        if (n == 1) return (false, 0);
        id = bound(seed, 1, n - 1);
        ok = !tab.getTab(id).closed;
    }

    function _sig(uint256 id, uint256 amt) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(clientPk, tab.hashVoucher(id, amt));
        return abi.encodePacked(r, s, v);
    }

    function open(uint256 amount, uint256 ttl, uint256 provSeed) external {
        amount = bound(amount, 1, 1_000e6);
        ttl = bound(ttl, 1 hours, 5 days);
        usdc.mint(client, amount);
        totalMinted += amount;
        vm.prank(client);
        tab.openTab(_prov(provSeed), amount, block.timestamp + ttl);
    }

    function topUp(uint256 seed, uint256 amount) external {
        (bool ok, uint256 id) = _pickTab(seed);
        if (!ok || block.timestamp >= tab.getTab(id).expiresAt) return;
        amount = bound(amount, 1, 500e6);
        usdc.mint(client, amount);
        totalMinted += amount;
        vm.prank(client);
        tab.topUp(id, amount);
    }

    function redeem(uint256 seed, uint256 amtSeed) external {
        (bool ok, uint256 id) = _pickTab(seed);
        if (!ok) return;
        AgentTab.Tab memory t = tab.getTab(id);
        uint256 cum = bound(amtSeed, 1, t.deposit * 2);
        bytes memory sig = _sig(id, cum);
        vm.prank(t.provider);
        if (cum >= t.deposit ? t.deposit <= t.paid : cum <= t.paid) {
            vm.expectRevert(AgentTab.StaleVoucher.selector);
        }
        tab.redeem(id, cum, sig);
    }

    function providerClose(uint256 seed, uint256 amtSeed, bool withVoucher) external {
        (bool ok, uint256 id) = _pickTab(seed);
        if (!ok) return;
        AgentTab.Tab memory t = tab.getTab(id);
        uint256 cum = withVoucher ? bound(amtSeed, 0, t.deposit * 2) : 0;
        bytes memory sig = withVoucher ? _sig(id, cum) : bytes("");
        vm.prank(t.provider);
        tab.closeTab(id, cum, sig);
    }

    function clientClose(uint256 seed) external {
        (bool ok, uint256 id) = _pickTab(seed);
        if (!ok) return;
        vm.prank(client);
        if (block.timestamp < tab.getTab(id).expiresAt) {
            vm.expectRevert(AgentTab.TabNotExpired.selector);
        }
        tab.closeTab(id);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 3 days));
    }
}

contract AgentTabInvariantTest is Test {
    AgentTab internal tab;
    MockUSDC internal usdc;
    AgentTabHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        (address client, uint256 pk) = makeAddrAndKey("client");
        usdc = new MockUSDC();
        tab = new AgentTab(IERC20(address(usdc)));
        handler = new AgentTabHandler(tab, usdc, pk, client);
        targetContract(address(handler));
    }

    /// Contract balance == Σ (deposit - paid) over open tabs; paid never exceeds deposit.
    function invariant_BalanceEqualsOutstandingOnOpenTabs() public view {
        uint256 n = tab.nextTabId();
        uint256 outstanding;
        for (uint256 id = 1; id < n; id++) {
            AgentTab.Tab memory t = tab.getTab(id);
            assertLe(t.paid, t.deposit);
            if (!t.closed) outstanding += t.deposit - t.paid;
        }
        assertEq(usdc.balanceOf(address(tab)), outstanding);
    }

    /// No value created or destroyed across client, providers and the contract.
    function invariant_ValueConserved() public view {
        uint256 sum = usdc.balanceOf(handler.client()) + usdc.balanceOf(handler.provider1())
            + usdc.balanceOf(handler.provider2()) + usdc.balanceOf(address(tab));
        assertEq(sum, handler.totalMinted());
    }
}
