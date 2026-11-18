// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";
import {QorePrecompiles} from "../src/interfaces/IQorePrecompiles.sol";
import {MockPQCVerify} from "./mocks/MockPQCVerify.sol";

abstract contract BlindspotTestBase is Test {
    BlindspotMarkets bs;
    MockPQCVerify pqc;

    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    bytes sealerPk;
    bytes sealerSk;
    bytes councilPk;

    uint64 closeTime;
    uint64 revealDeadline;
    uint64 resolveDeadline;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        bs = new BlindspotMarkets(treasury, 200); // 2% fee
        pqc = new MockPQCVerify();
        vm.etch(QorePrecompiles.PQC_VERIFY, address(pqc).code);

        sealerPk = _bytes(1568, 0x11);
        sealerSk = _bytes(3168, 0x22);
        councilPk = _bytes(2592, 0x33);

        closeTime = uint64(block.timestamp + 1 days);
        revealDeadline = closeTime + 1 hours;
        resolveDeadline = revealDeadline + 7 days;

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _createMarket() internal returns (uint256) {
        return bs.createMarket(
            "Will BTC close above $150k on Dec 31?",
            closeTime,
            revealDeadline,
            resolveDeadline,
            sealerPk,
            keccak256(sealerSk),
            councilPk
        );
    }

    function _bytes(uint256 len, bytes1 fill) internal pure returns (bytes memory b) {
        b = new bytes(len);
        for (uint256 i; i < len; ++i) b[i] = fill;
    }
}
