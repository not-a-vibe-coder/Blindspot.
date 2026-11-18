// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BlindspotTestBase} from "./BlindspotTestBase.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";

contract PayoutsTest is BlindspotTestBase {
    uint256 id;

    uint256[] betIds;
    BlindspotMarkets.Side[] sides;
    bytes32[] salts;

    function setUp() public override {
        super.setUp();
        id = _createMarket();
    }

    function _place(address who, BlindspotMarkets.Side side, uint256 amount) internal returns (uint256 betId) {
        bytes32 salt;
        (betId, salt) = _bet(id, who, side, amount);
        betIds.push(betId);
        sides.push(side);
        salts.push(salt);
    }

    function _releaseAndRevealAll() internal {
        vm.warp(closeTime);
        bs.releaseSealerKey(id, sealerSk);
        bs.revealBets(id, betIds, sides, salts);
    }

    function _council(BlindspotMarkets.Outcome o) internal {
        bytes memory sig = pqc.fakeSign(councilPk, bs.resolutionMessage(id, o));
        bs.resolveByCouncil(id, o, councilPk, sig);
    }

    function test_WinnersSplitLosingPoolMinusFee() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        uint256 b = _place(bob, BlindspotMarkets.Side.No, 1 ether);
        uint256 c = _place(carol, BlindspotMarkets.Side.Yes, 1 ether);
        _releaseAndRevealAll();
        _council(BlindspotMarkets.Outcome.Yes);
        vm.warp(revealDeadline);

        // total 4, winning 3, fee = 2% of losing 1 = 0.02
        uint256 distributable = 4 ether - 0.02 ether;
        (uint256 preview,) = bs.previewPayout(id, a);
        assertEq(preview, 2 ether * distributable / 3 ether);

        uint256 aBefore = alice.balance;
        bs.claim(id, a); // relayed by the test contract — funds still go to alice
        assertEq(alice.balance - aBefore, 2 ether * distributable / 3 ether);

        uint256 cBefore = carol.balance;
        vm.prank(carol);
        bs.claim(id, c);
        assertEq(carol.balance - cBefore, 1 ether * distributable / 3 ether);

        vm.expectRevert(BlindspotMarkets.NotAWinner.selector);
        bs.claim(id, b);

        bs.collectFees(id);
        assertEq(bs.credits(treasury), 0.02 ether);
        vm.expectRevert(BlindspotMarkets.NoFees.selector);
        bs.collectFees(id);

        // only rounding dust (<= a few wei) + the fee credit remain
        assertLe(address(bs).balance - 0.02 ether, 2);
    }

    function test_UnrevealedBetsAreForfeitedToWinners() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        _place(bob, BlindspotMarkets.Side.No, 1 ether);
        // carol bets but never reveals (e.g. submits garbage ciphertext hoping to self-reveal only if winning)
        (uint256 c,) = _bet(id, carol, BlindspotMarkets.Side.Yes, 1 ether);
        _releaseAndRevealAll();
        _council(BlindspotMarkets.Outcome.Yes);
        vm.warp(revealDeadline);

        // winning 2, losing+forfeited 2, fee 0.04
        uint256 before = alice.balance;
        bs.claim(id, a);
        assertEq(alice.balance - before, 4 ether - 0.04 ether);

        vm.expectRevert(BlindspotMarkets.NotAWinner.selector);
        bs.claim(id, c);
    }

    function test_RefundsIfSealerNeverReleasesKey() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        uint256 b = _place(bob, BlindspotMarkets.Side.No, 1 ether);
        vm.warp(closeTime);
        bs.revealBets(id, betIds, sides, salts); // self-reveals happen, but no key release
        _council(BlindspotMarkets.Outcome.Yes);
        vm.warp(revealDeadline);

        (uint256 p, bool refund) = bs.previewPayout(id, b);
        assertTrue(refund);
        assertEq(p, 1 ether);

        uint256 bBefore = bob.balance;
        bs.claim(id, b);
        assertEq(bob.balance - bBefore, 1 ether);
        bs.claim(id, a);
        vm.expectRevert(BlindspotMarkets.NoFees.selector);
        bs.collectFees(id);
    }

    function test_RefundsOnInvalid() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        _releaseAndRevealAll();
        _council(BlindspotMarkets.Outcome.Invalid);
        vm.warp(revealDeadline);
        uint256 before = alice.balance;
        bs.claim(id, a);
        assertEq(alice.balance - before, 2 ether);
    }

    function test_RefundsIfNobodyWon() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        _releaseAndRevealAll();
        _council(BlindspotMarkets.Outcome.No);
        vm.warp(revealDeadline);
        uint256 before = alice.balance;
        bs.claim(id, a);
        assertEq(alice.balance - before, 2 ether);
    }

    function test_ClaimAutoSettlesOptimisticProposal() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        _place(bob, BlindspotMarkets.Side.No, 1 ether);
        _releaseAndRevealAll();
        uint128 bond = bs.proposalBond();
        vm.prank(carol);
        bs.proposeOutcome{value: bond}(id, BlindspotMarkets.Outcome.Yes);
        vm.warp(revealDeadline + bs.LIVENESS());

        (uint256 preview,) = bs.previewPayout(id, a);
        uint256 before = alice.balance;
        bs.claim(id, a);
        assertEq(alice.balance - before, preview);
        assertEq(uint8(bs.getResolution(id).outcome), uint8(BlindspotMarkets.Outcome.Yes));
        assertEq(bs.credits(carol), bond);
    }

    function test_ClaimGuards() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        _place(bob, BlindspotMarkets.Side.No, 1 ether);
        _releaseAndRevealAll();
        _council(BlindspotMarkets.Outcome.Yes);

        vm.expectRevert(BlindspotMarkets.RevealsStillOpen.selector);
        bs.claim(id, a);

        vm.warp(revealDeadline);
        bs.claim(id, a);
        vm.expectRevert(BlindspotMarkets.AlreadyClaimed.selector);
        bs.claim(id, a);
    }

    function test_ClaimRevertsWhileUnresolved() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 2 ether);
        _releaseAndRevealAll();
        vm.warp(revealDeadline);
        vm.expectRevert(BlindspotMarkets.NotSettleable.selector);
        bs.claim(id, a);
    }

    function test_FeeIsSnapshottedAtCreation() public {
        uint256 a = _place(alice, BlindspotMarkets.Side.Yes, 1 ether);
        _place(bob, BlindspotMarkets.Side.No, 1 ether);
        bs.setFeeConfig(treasury, 500); // admin raises fee mid-market
        _releaseAndRevealAll();
        _council(BlindspotMarkets.Outcome.Yes);
        vm.warp(revealDeadline);
        uint256 before = alice.balance;
        bs.claim(id, a);
        assertEq(alice.balance - before, 2 ether - 0.02 ether); // still 2%
    }

    /// @dev Solvency: whatever the bets and outcome, the contract can always pay every claim + fee.
    function testFuzz_Solvency(uint96[6] memory amounts, bool[6] memory yes, bool[6] memory reveal, bool outcomeYes)
        public
    {
        address[6] memory users;
        uint256[6] memory ids;
        for (uint256 i; i < 6; ++i) {
            users[i] = address(uint160(0x1000 + i));
            uint256 amt = bound(uint256(amounts[i]), 0.001 ether, 50 ether);
            vm.deal(users[i], amt);
            BlindspotMarkets.Side s = yes[i] ? BlindspotMarkets.Side.Yes : BlindspotMarkets.Side.No;
            bytes32 salt;
            (ids[i], salt) = _bet(id, users[i], s, amt);
            if (reveal[i]) {
                betIds.push(ids[i]);
                sides.push(s);
                salts.push(salt);
            }
        }
        _releaseAndRevealAll();
        _council(outcomeYes ? BlindspotMarkets.Outcome.Yes : BlindspotMarkets.Outcome.No);
        vm.warp(revealDeadline);

        for (uint256 i; i < 6; ++i) {
            (uint256 p,) = bs.previewPayout(id, ids[i]);
            if (p > 0) bs.claim(id, ids[i]);
        }
        try bs.collectFees(id) {} catch {}
        uint256 owedFee = bs.credits(treasury);
        assertGe(address(bs).balance, owedFee, "insolvent");
        assertLe(address(bs).balance - owedFee, 6, "more than rounding dust left");
    }
}
