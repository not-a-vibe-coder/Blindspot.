// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title QoreChain EVM precompile interfaces
/// @notice Addresses and signatures from docs.qorechain.io/developer-guide/evm-precompiles.
///         On testnet (qorechain-diana, chain 9800) PQC Verify and PQC Key Status are active.
///         Calls to an INACTIVE precompile succeed and return empty data, so always
///         go through {QorePQC} which length-checks the raw return.

/// @dev ML-DSA-87 signature verification (FIPS 204). Gas: 25,000 + 8/byte of input.
interface IQorePQCVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);
}

/// @dev Registered post-quantum key for an account. Gas: 2,500 flat.
interface IQorePQCKeyStatus {
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

library QorePrecompiles {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;

    uint256 internal constant MLDSA87_PUBKEY_LEN = 2592;
    uint256 internal constant MLDSA87_SIG_LEN = 4627;
    uint8 internal constant ALG_MLDSA87 = 1;
}
