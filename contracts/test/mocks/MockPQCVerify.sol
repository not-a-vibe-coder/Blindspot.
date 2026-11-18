// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stand-in for QoreChain's ML-DSA-87 precompile in local tests (Anvil / forge).
/// @dev Real ML-DSA can't run in the EVM, so the mock uses a deterministic fake:
///      a signature is valid iff its first 32 bytes equal keccak256(pubkey, message).
///      Lengths still match ML-DSA-87 so size checks are exercised for real.
///      `vm.etch` this at 0x...0A01 (see BlindspotTestBase).
contract MockPQCVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        if (signature.length < 32) return false;
        return bytes32(signature[:32]) == keccak256(abi.encodePacked(pubkey, message));
    }

    /// @dev Helper so tests can produce a "valid" signature for the mock.
    function fakeSign(bytes calldata pubkey, bytes calldata message) external pure returns (bytes memory sig) {
        sig = new bytes(4627);
        bytes32 h = keccak256(abi.encodePacked(pubkey, message));
        assembly {
            mstore(add(sig, 32), h)
        }
    }
}
