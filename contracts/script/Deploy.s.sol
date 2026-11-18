// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BlindspotMarkets} from "../src/BlindspotMarkets.sol";
import {QorePrecompiles} from "../src/interfaces/IQorePrecompiles.sol";

/// @notice Deploy Blindspot to QoreChain.
///
///   cd contracts
///   PRIVATE_KEY=0x... TREASURY=0x... FEE_BPS=200 \
///     forge script script/Deploy.s.sol --rpc-url qorechain_testnet --broadcast --legacy
///
/// Writes deployments/<chainId>.json for the SDK + services.
contract Deploy is Script {
    function run() external returns (BlindspotMarkets bs) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(200)));

        _preflight();

        vm.startBroadcast(pk);
        bs = new BlindspotMarkets(treasury, feeBps);
        vm.stopBroadcast();

        console2.log("BlindspotMarkets:", address(bs));
        console2.log("chainId:", block.chainid);

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "treasury", treasury);
        vm.serializeUint(obj, "feeBps", feeBps);
        vm.serializeUint(obj, "deployedAtBlock", block.number);
        string memory json = vm.serializeAddress(obj, "BlindspotMarkets", address(bs));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }

    /// @dev On QoreChain testnet the ML-DSA-87 precompile must be live, otherwise council
    ///      resolution would always fail closed. Warn loudly instead of deploying blind.
    function _preflight() internal view {
        if (block.chainid != 9800 && block.chainid != 9801) return;
        (bool ok, bytes memory ret) = QorePrecompiles.PQC_VERIFY.staticcall(
            abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", new bytes(0), new bytes(0), new bytes(0))
        );
        if (!ok || ret.length < 32) {
            console2.log("WARNING: PQC Verify precompile (0x0a01) is NOT active on this chain.");
            console2.log("         Council resolution will fail; only the optimistic path will work.");
        } else {
            console2.log("PQC Verify precompile (0x0a01): active");
        }
    }
}
