// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BlindspotTestBase} from "./BlindspotTestBase.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";

contract OptimisticOracleTest is BlindspotTestBase {
    uint256 id;
    uint128 bond;
    uint64 liveness;

    function setUp() public override {
        super.setUp();
        id = _createMarket();
        bond = bs.proposalBond();
        liveness = bs.LIVENESS();
    }

    function _propose(address who, BlindspotMarkets.Outcome o) internal {
        vm.prank(who);
        bs.proposeOutcome{value: bond}(id, o);
    }

    function _council(BlindspotMarkets.Outcome o) internal {
        bytes memory sig = pqc.fakeSign(councilPk, bs.resolutionMessage(id, o));
        bs.resolveByCouncil(id, o, councilPk, sig);
    }

    function test_UndisputedProposalSettlesAfterLiveness() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);

        vm.expectRevert(BlindspotMarkets.NotSettleable.selector);
        bs.settle(id);

        vm.warp(closeTime + liveness);
        bs.settle(id);
        BlindspotMarkets.Resolution memory r = bs.getResolution(id);
        assertEq(uint8(r.outcome), uint8(BlindspotMarkets.Outcome.Yes));
        assertFalse(r.viaCouncil);
        assertEq(bs.credits(alice), bond);

        uint256 before = alice.balance;
        vm.prank(alice);
        bs.withdrawCredits();
        assertEq(alice.balance, before + bond);
        assertEq(bs.credits(alice), 0);
    }

    function test_DisputeEscalatesToCouncil_DisputerWins() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);
        vm.prank(bob);
        bs.disputeOutcome{value: bond}(id);

        // past liveness, a disputed proposal is NOT auto-final
        vm.warp(closeTime + liveness);
        vm.expectRevert(BlindspotMarkets.NotSettleable.selector);
        bs.settle(id);

        _council(BlindspotMarkets.Outcome.No);
        assertEq(uint8(bs.getResolution(id).outcome), uint8(BlindspotMarkets.Outcome.No));
        assertEq(bs.credits(bob), uint256(bond) * 2);
        assertEq(bs.credits(alice), 0);
    }

    function test_DisputeEscalatesToCouncil_ProposerWins() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);
        vm.prank(bob);
        bs.disputeOutcome{value: bond}(id);
        _council(BlindspotMarkets.Outcome.Yes);
        assertEq(bs.credits(alice), uint256(bond) * 2);
        assertEq(bs.credits(bob), 0);
    }

    function test_CouncilOverridesWrongUndisputedProposal_Slashes() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);
        _council(BlindspotMarkets.Outcome.No);
        assertEq(bs.credits(treasury), bond);
        assertEq(bs.credits(alice), 0);
    }

    function test_CouncilConfirmsUndisputedProposal_Refunds() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);
        _council(BlindspotMarkets.Outcome.Yes);
        assertEq(bs.credits(alice), bond);
    }

    function test_DeadlineWithoutFinalIsInvalidAndRefundsBonds() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);
        vm.prank(bob);
        bs.disputeOutcome{value: bond}(id);

        vm.warp(resolveDeadline);
        bs.settle(id);
        assertEq(uint8(bs.getResolution(id).outcome), uint8(BlindspotMarkets.Outcome.Invalid));
        assertEq(bs.credits(alice), bond);
        assertEq(bs.credits(bob), bond);
    }

    function test_DeadlineWithNoProposalIsInvalid() public {
        vm.warp(resolveDeadline);
        bs.settle(id);
        assertEq(uint8(bs.getResolution(id).outcome), uint8(BlindspotMarkets.Outcome.Invalid));
    }

    function test_ProposalGuards() public {
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.MarketStillOpen.selector);
        bs.proposeOutcome{value: bond}(id, BlindspotMarkets.Outcome.Yes);

        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.WrongBond.selector);
        bs.proposeOutcome{value: bond - 1}(id, BlindspotMarkets.Outcome.Yes);

        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.InvalidOutcome.selector);
        bs.proposeOutcome{value: bond}(id, BlindspotMarkets.Outcome.Unresolved);

        _propose(alice, BlindspotMarkets.Outcome.Yes);
        vm.prank(bob);
        vm.expectRevert(BlindspotMarkets.ProposalExists.selector);
        bs.proposeOutcome{value: bond}(id, BlindspotMarkets.Outcome.No);
    }

    function test_ProposalTooCloseToDeadline() public {
        vm.warp(resolveDeadline - liveness + 1);
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.ResolutionExpired.selector);
        bs.proposeOutcome{value: bond}(id, BlindspotMarkets.Outcome.Yes);
    }

    function test_DisputeGuards() public {
        vm.warp(closeTime);
        vm.prank(bob);
        vm.expectRevert(BlindspotMarkets.NoProposal.selector);
        bs.disputeOutcome{value: bond}(id);

        _propose(alice, BlindspotMarkets.Outcome.Yes);
        vm.prank(bob);
        vm.expectRevert(BlindspotMarkets.WrongBond.selector);
        bs.disputeOutcome{value: 1}(id);

        vm.prank(bob);
        bs.disputeOutcome{value: bond}(id);
        vm.prank(carol);
        vm.expectRevert(BlindspotMarkets.AlreadyDisputed.selector);
        bs.disputeOutcome{value: bond}(id);
    }

    function test_CannotDisputeAfterLiveness() public {
        vm.warp(closeTime);
        _propose(alice, BlindspotMarkets.Outcome.Yes);
        vm.warp(closeTime + liveness);
        vm.prank(bob);
        vm.expectRevert(BlindspotMarkets.LivenessOver.selector);
        bs.disputeOutcome{value: bond}(id);
    }

    function test_WithdrawNothingReverts() public {
        vm.prank(carol);
        vm.expectRevert(BlindspotMarkets.NothingToWithdraw.selector);
        bs.withdrawCredits();
    }

    function test_OwnerSetsBond() public {
        bs.setProposalBond(1 ether);
        assertEq(bs.proposalBond(), 1 ether);
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.NotOwner.selector);
        bs.setProposalBond(0);
    }
}
