// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IQorePQCVerify, QorePrecompiles} from "../interfaces/IQorePrecompiles.sol";

/// @title QorePQC
/// @notice Safe wrapper around QoreChain's ML-DSA-87 verify precompile.
/// @dev An inactive precompile returns `0x` instead of reverting, which a typed call
///      would mis-decode. We staticcall and require a full 32-byte word back, so a
///      chain without the precompile fails closed (signature treated as invalid).
library QorePQC {
    error PQCPrecompileUnavailable();

    function verify(bytes memory pubkey, bytes memory signature, bytes memory message)
        internal
        view
        returns (bool)
    {
        if (pubkey.length != QorePrecompiles.MLDSA87_PUBKEY_LEN) return false;
        if (signature.length != QorePrecompiles.MLDSA87_SIG_LEN) return false;

        (bool ok, bytes memory ret) = QorePrecompiles.PQC_VERIFY.staticcall(
            abi.encodeCall(IQorePQCVerify.pqcVerify, (pubkey, signature, message))
        );
        if (!ok || ret.length < 32) revert PQCPrecompileUnavailable();
        return abi.decode(ret, (bool));
    }
}
