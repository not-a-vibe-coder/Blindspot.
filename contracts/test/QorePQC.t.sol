// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {QorePQC} from "../src/libraries/QorePQC.sol";
import {QorePrecompiles} from "../src/interfaces/IQorePrecompiles.sol";
import {MockPQCVerify} from "./mocks/MockPQCVerify.sol";

contract PQCHarness {
    function verify(bytes memory pk, bytes memory sig, bytes memory m) external view returns (bool) {
        return QorePQC.verify(pk, sig, m);
    }
}

contract QorePQCTest is Test {
    PQCHarness h;
    MockPQCVerify mock;
    bytes pk;

    function setUp() public {
        h = new PQCHarness();
        mock = new MockPQCVerify();
        pk = new bytes(QorePrecompiles.MLDSA87_PUBKEY_LEN);
        pk[0] = 0x42;
    }

    function test_FailsClosedWhenPrecompileInactive() public {
        // Nothing etched at 0x0A01 -> call returns empty data -> must revert, never "true".
        bytes memory sig = new bytes(QorePrecompiles.MLDSA87_SIG_LEN);
        vm.expectRevert(QorePQC.PQCPrecompileUnavailable.selector);
        h.verify(pk, sig, "hello");
    }

    function test_VerifiesWithPrecompile() public {
        vm.etch(QorePrecompiles.PQC_VERIFY, address(mock).code);
        bytes memory sig = mock.fakeSign(pk, "hello");
        assertTrue(h.verify(pk, sig, "hello"));
        assertFalse(h.verify(pk, sig, "tampered"));
    }

    function test_RejectsWrongLengths() public {
        vm.etch(QorePrecompiles.PQC_VERIFY, address(mock).code);
        bytes memory sig = mock.fakeSign(pk, "hello");
        assertFalse(h.verify(new bytes(10), sig, "hello"));
        assertFalse(h.verify(pk, new bytes(32), "hello"));
    }
}
