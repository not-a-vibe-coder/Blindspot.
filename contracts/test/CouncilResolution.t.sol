// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BlindspotTestBase} from "./BlindspotTestBase.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";

contract CouncilResolutionTest is BlindspotTestBase {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _createMarket();
    }

    function _sig(BlindspotMarkets.Outcome o) internal view returns (bytes memory) {
        return pqc.fakeSign(councilPk, bs.resolutionMessage(id, o));
    }

    function test_CouncilResolves() public {
        vm.warp(closeTime);
        bytes memory sig = _sig(BlindspotMarkets.Outcome.Yes);
        vm.expectEmit(true, false, false, true);
        emit BlindspotMarkets.MarketResolved(id, BlindspotMarkets.Outcome.Yes, true);
        vm.prank(carol); // relayed by a random wallet
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Yes, councilPk, sig);

        BlindspotMarkets.Resolution memory r = bs.getResolution(id);
        assertEq(uint8(r.outcome), uint8(BlindspotMarkets.Outcome.Yes));
        assertTrue(r.viaCouncil);
    }

    function test_SignatureBoundToOutcome() public {
        vm.warp(closeTime);
        bytes memory sigYes = _sig(BlindspotMarkets.Outcome.Yes);
        vm.expectRevert(BlindspotMarkets.BadCouncilSignature.selector);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.No, councilPk, sigYes);
    }

    function test_SignatureBoundToMarket() public {
        uint256 other = _createMarket();
        vm.warp(closeTime);
        bytes memory sigForFirst = _sig(BlindspotMarkets.Outcome.Yes);
        vm.expectRevert(BlindspotMarkets.BadCouncilSignature.selector);
        bs.resolveByCouncil(other, BlindspotMarkets.Outcome.Yes, councilPk, sigForFirst);
    }

    function test_RejectsWrongCouncilKey() public {
        vm.warp(closeTime);
        bytes memory otherPk = _bytes(2592, 0x77);
        bytes memory sig = pqc.fakeSign(otherPk, bs.resolutionMessage(id, BlindspotMarkets.Outcome.Yes));
        vm.expectRevert(BlindspotMarkets.WrongCouncilKey.selector);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Yes, otherPk, sig);
    }

    function test_TimingAndOnce() public {
        bytes memory sig = _sig(BlindspotMarkets.Outcome.Yes);
        vm.expectRevert(BlindspotMarkets.MarketStillOpen.selector);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Yes, councilPk, sig);

        vm.warp(closeTime);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Yes, councilPk, sig);
        vm.expectRevert(BlindspotMarkets.AlreadyResolved.selector);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Yes, councilPk, sig);
    }

    function test_ExpiresAtDeadline() public {
        vm.warp(resolveDeadline);
        bytes memory sig = _sig(BlindspotMarkets.Outcome.Yes);
        vm.expectRevert(BlindspotMarkets.ResolutionExpired.selector);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Yes, councilPk, sig);
    }

    function test_RejectsUnresolvedOutcome() public {
        vm.warp(closeTime);
        bytes memory sig = _sig(BlindspotMarkets.Outcome.Unresolved);
        vm.expectRevert(BlindspotMarkets.InvalidOutcome.selector);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Unresolved, councilPk, sig);
    }

    function test_InvalidOutcomeAllowed() public {
        vm.warp(closeTime);
        bytes memory sig = _sig(BlindspotMarkets.Outcome.Invalid);
        bs.resolveByCouncil(id, BlindspotMarkets.Outcome.Invalid, councilPk, sig);
        assertEq(uint8(bs.getResolution(id).outcome), uint8(BlindspotMarkets.Outcome.Invalid));
    }
}
