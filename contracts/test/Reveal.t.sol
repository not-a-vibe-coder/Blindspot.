// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BlindspotTestBase} from "./BlindspotTestBase.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";

contract RevealTest is BlindspotTestBase {
    uint256 id;
    uint256 aliceBet;
    bytes32 aliceSalt;
    uint256 bobBet;
    bytes32 bobSalt;

    function setUp() public override {
        super.setUp();
        id = _createMarket();
        (aliceBet, aliceSalt) = _bet(id, alice, BlindspotMarkets.Side.Yes, 2 ether);
        (bobBet, bobSalt) = _bet(id, bob, BlindspotMarkets.Side.No, 1 ether);
    }

    function _one(uint256 x) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = x;
    }

    function _side(BlindspotMarkets.Side s) internal pure returns (BlindspotMarkets.Side[] memory a) {
        a = new BlindspotMarkets.Side[](1);
        a[0] = s;
    }

    function _salt(bytes32 s) internal pure returns (bytes32[] memory a) {
        a = new bytes32[](1);
        a[0] = s;
    }

    // ── key release ──

    function test_ReleasesSealerKeyAfterClose() public {
        vm.warp(closeTime);
        vm.expectEmit(true, false, false, true);
        emit BlindspotMarkets.SealerKeyReleased(id, sealerSk);
        vm.prank(carol); // anyone can submit — the hash proves it
        bs.releaseSealerKey(id, sealerSk);
        assertTrue(bs.sealerKeyReleased(id));
    }

    function test_CannotReleaseKeyBeforeClose() public {
        vm.expectRevert(BlindspotMarkets.NotInRevealWindow.selector);
        bs.releaseSealerKey(id, sealerSk);
    }

    function test_CannotReleaseWrongOrDuplicateKey() public {
        vm.warp(closeTime);
        vm.expectRevert(BlindspotMarkets.WrongSealerKey.selector);
        bs.releaseSealerKey(id, _bytes(3168, 0x99));

        bs.releaseSealerKey(id, sealerSk);
        vm.expectRevert(BlindspotMarkets.KeyAlreadyReleased.selector);
        bs.releaseSealerKey(id, sealerSk);
    }

    // ── reveals ──

    function test_BatchRevealUpdatesPools() public {
        vm.warp(closeTime);
        uint256[] memory ids = new uint256[](2);
        ids[0] = aliceBet;
        ids[1] = bobBet;
        BlindspotMarkets.Side[] memory sides = new BlindspotMarkets.Side[](2);
        sides[0] = BlindspotMarkets.Side.Yes;
        sides[1] = BlindspotMarkets.Side.No;
        bytes32[] memory salts = new bytes32[](2);
        salts[0] = aliceSalt;
        salts[1] = bobSalt;

        bs.revealBets(id, ids, sides, salts);

        BlindspotMarkets.Pool memory p = bs.getPool(id);
        assertEq(p.revealedYes, 2 ether);
        assertEq(p.revealedNo, 1 ether);
        assertEq(p.revealedCount, 2);
        assertEq(uint8(bs.getBet(id, aliceBet).side), uint8(BlindspotMarkets.Side.Yes));
    }

    function test_SelfRevealAndDuplicateIsSkipped() public {
        vm.warp(closeTime);
        vm.prank(alice);
        bs.revealBets(id, _one(aliceBet), _side(BlindspotMarkets.Side.Yes), _salt(aliceSalt));
        // sealer re-submits the same reveal in its batch: no double count, no revert
        bs.revealBets(id, _one(aliceBet), _side(BlindspotMarkets.Side.Yes), _salt(aliceSalt));
        assertEq(bs.getPool(id).revealedYes, 2 ether);
        assertEq(bs.getPool(id).revealedCount, 1);
    }

    function test_CannotFlipSide() public {
        vm.warp(closeTime);
        vm.expectRevert(abi.encodeWithSelector(BlindspotMarkets.InvalidReveal.selector, aliceBet));
        bs.revealBets(id, _one(aliceBet), _side(BlindspotMarkets.Side.No), _salt(aliceSalt));
    }

    function test_CannotRevealHidden() public {
        vm.warp(closeTime);
        vm.expectRevert(abi.encodeWithSelector(BlindspotMarkets.InvalidReveal.selector, aliceBet));
        bs.revealBets(id, _one(aliceBet), _side(BlindspotMarkets.Side.Hidden), _salt(aliceSalt));
    }

    function test_RevealWindowEnforced() public {
        vm.expectRevert(BlindspotMarkets.NotInRevealWindow.selector);
        bs.revealBets(id, _one(aliceBet), _side(BlindspotMarkets.Side.Yes), _salt(aliceSalt));

        vm.warp(revealDeadline);
        vm.expectRevert(BlindspotMarkets.NotInRevealWindow.selector);
        bs.revealBets(id, _one(aliceBet), _side(BlindspotMarkets.Side.Yes), _salt(aliceSalt));
    }

    function test_LengthMismatch() public {
        vm.warp(closeTime);
        vm.expectRevert(BlindspotMarkets.LengthMismatch.selector);
        bs.revealBets(id, _one(aliceBet), new BlindspotMarkets.Side[](0), _salt(aliceSalt));
    }
}
