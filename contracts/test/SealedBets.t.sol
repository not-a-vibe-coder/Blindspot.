// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BlindspotTestBase} from "./BlindspotTestBase.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";

contract SealedBetsTest is BlindspotTestBase {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _createMarket();
    }

    function test_PlacesSealedBet() public {
        (uint256 betId,) = _bet(id, alice, BlindspotMarkets.Side.Yes, 1 ether);
        assertEq(betId, 1);

        BlindspotMarkets.Bet memory b = bs.getBet(id, betId);
        assertEq(b.bettor, alice);
        assertEq(b.amount, 1 ether);
        assertEq(uint8(b.side), uint8(BlindspotMarkets.Side.Hidden), "side must stay hidden");

        BlindspotMarkets.Pool memory p = bs.getPool(id);
        assertEq(p.totalStaked, 1 ether);
        assertEq(p.betCount, 1);
        assertEq(p.revealedYes, 0);
        assertEq(p.revealedNo, 0);
        assertEq(address(bs).balance, 1 ether);
    }

    function test_PoolOnlyShowsTotals() public {
        _bet(id, alice, BlindspotMarkets.Side.Yes, 1 ether);
        _bet(id, bob, BlindspotMarkets.Side.No, 3 ether);
        BlindspotMarkets.Pool memory p = bs.getPool(id);
        assertEq(p.totalStaked, 4 ether);
        assertEq(p.betCount, 2);
        assertEq(p.revealedYes + p.revealedNo, 0);
    }

    function test_EmitsSealedPayload() public {
        bytes memory sealed_ = _bytes(bs.MIN_SEALED_LEN(), 0x44);
        bytes32 c = bs.commitmentFor(id, alice, BlindspotMarkets.Side.No, bytes32("salt"));
        vm.expectEmit(true, true, true, true);
        emit BlindspotMarkets.BetPlaced(id, 1, alice, 1 ether, c, sealed_);
        vm.prank(alice);
        bs.placeBet{value: 1 ether}(id, c, sealed_);
    }

    function test_CommitmentIsBoundToBettor() public view {
        bytes32 a = bs.commitmentFor(id, alice, BlindspotMarkets.Side.Yes, bytes32("s"));
        bytes32 b = bs.commitmentFor(id, bob, BlindspotMarkets.Side.Yes, bytes32("s"));
        assertTrue(a != b);
    }

    function test_RevertsAfterClose() public {
        bytes32 c = bs.commitmentFor(id, alice, BlindspotMarkets.Side.Yes, bytes32("s"));
        bytes memory payload = sealedPayload;
        vm.warp(closeTime);
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.BettingClosed.selector);
        bs.placeBet{value: 1 ether}(id, c, payload);
    }

    function test_RevertsOnDust() public {
        bytes32 c = bs.commitmentFor(id, alice, BlindspotMarkets.Side.Yes, bytes32("s"));
        bytes memory payload = sealedPayload;
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.BetTooSmall.selector);
        bs.placeBet{value: 0.0001 ether}(id, c, payload);
    }

    function test_RevertsOnBadPayload() public {
        bytes32 c = bs.commitmentFor(id, alice, BlindspotMarkets.Side.Yes, bytes32("s"));
        bytes memory payload = sealedPayload;
        vm.startPrank(alice);
        vm.expectRevert(BlindspotMarkets.InvalidSealedSide.selector);
        bs.placeBet{value: 1 ether}(id, c, new bytes(100));
        vm.expectRevert(BlindspotMarkets.InvalidSealedSide.selector);
        bs.placeBet{value: 1 ether}(id, c, new bytes(4096));
        vm.expectRevert(BlindspotMarkets.InvalidCommitment.selector);
        bs.placeBet{value: 1 ether}(id, bytes32(0), payload);
        vm.stopPrank();
    }

    function test_RevertsOnUnknownMarketOrBet() public {
        bytes memory payload = sealedPayload;
        vm.prank(alice);
        vm.expectRevert(BlindspotMarkets.UnknownMarket.selector);
        bs.placeBet{value: 1 ether}(99, bytes32("c"), payload);
        vm.expectRevert(BlindspotMarkets.UnknownBet.selector);
        bs.getBet(id, 7);
    }
}
