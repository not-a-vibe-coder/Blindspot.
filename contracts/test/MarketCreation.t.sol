// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BlindspotTestBase} from "./BlindspotTestBase.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";

contract MarketCreationTest is BlindspotTestBase {
    function test_CreatesMarket() public {
        uint256 id = _createMarket();
        assertEq(id, 1);
        assertEq(bs.marketCount(), 1);

        BlindspotMarkets.Market memory m = bs.getMarket(id);
        assertEq(m.creator, address(this));
        assertEq(m.closeTime, closeTime);
        assertEq(m.sealerKeyHash, keccak256(sealerSk));
        assertEq(m.councilKeyHash, keccak256(councilPk));
        assertEq(bs.question(id), "Will BTC close above $150k on Dec 31?");
    }

    function test_EmitsKeysForBettors() public {
        vm.expectEmit(true, true, false, true);
        emit BlindspotMarkets.MarketCreated(
            1,
            address(this),
            "Will BTC close above $150k on Dec 31?",
            closeTime,
            revealDeadline,
            resolveDeadline,
            sealerPk,
            councilPk
        );
        _createMarket();
    }

    function test_RevertsOnBadSchedule() public {
        vm.expectRevert(BlindspotMarkets.InvalidSchedule.selector);
        bs.createMarket("q", uint64(block.timestamp), revealDeadline, resolveDeadline, sealerPk, bytes32("h"), councilPk);

        vm.expectRevert(BlindspotMarkets.InvalidSchedule.selector);
        bs.createMarket("q", closeTime, closeTime + 5 minutes, resolveDeadline, sealerPk, bytes32("h"), councilPk);

        vm.expectRevert(BlindspotMarkets.InvalidSchedule.selector);
        bs.createMarket("q", closeTime, revealDeadline, revealDeadline - 1, sealerPk, bytes32("h"), councilPk);
    }

    function test_RevertsOnBadKeys() public {
        vm.expectRevert(BlindspotMarkets.InvalidKey.selector);
        bs.createMarket("q", closeTime, revealDeadline, resolveDeadline, new bytes(32), bytes32("h"), councilPk);

        vm.expectRevert(BlindspotMarkets.InvalidKey.selector);
        bs.createMarket("q", closeTime, revealDeadline, resolveDeadline, sealerPk, bytes32(0), councilPk);

        vm.expectRevert(BlindspotMarkets.InvalidKey.selector);
        bs.createMarket("q", closeTime, revealDeadline, resolveDeadline, sealerPk, bytes32("h"), new bytes(64));
    }

    function test_RevertsOnEmptyQuestion() public {
        vm.expectRevert(BlindspotMarkets.EmptyQuestion.selector);
        bs.createMarket("", closeTime, revealDeadline, resolveDeadline, sealerPk, bytes32("h"), councilPk);
    }

    function test_UnknownMarketReverts() public {
        vm.expectRevert(BlindspotMarkets.UnknownMarket.selector);
        bs.getMarket(42);
    }

    function test_AdminFeeConfig() public {
        bs.setFeeConfig(alice, 300);
        assertEq(bs.treasury(), alice);
        assertEq(bs.feeBps(), 300);

        vm.expectRevert(BlindspotMarkets.InvalidFee.selector);
        bs.setFeeConfig(alice, 501);

        vm.prank(bob);
        vm.expectRevert(BlindspotMarkets.NotOwner.selector);
        bs.setFeeConfig(bob, 100);
    }
}
