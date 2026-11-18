// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Blindspot — the blind prediction market
/// @author Pascal Chukwu
/// @notice Parimutuel YES/NO markets where every bet's side stays sealed until close.
///
///  Concepts borrowed from other chains, rebuilt on QoreChain's post-quantum stack:
///   - Keyper encryption (Shutter Network / Gnosis): each market has a *sealer* that
///     publishes an ML-KEM-1024 public key. Bettors encrypt their side to it; the
///     secret key can only be released after close, and is committed up front.
///   - Commit-reveal (ENS auctions): every bet carries keccak(side, salt) so a side
///     can't be changed after the fact, whoever reveals it.
///   - Optimistic oracle (UMA): anyone proposes an outcome with a bond; anyone can
///     dispute inside the liveness window.
///   - Post-quantum council: disputes (and fast-path resolutions) are settled by an
///     ML-DSA-87 signature, verified on-chain by QoreChain's 0x0a01 precompile.
///   - Parimutuel pools (Augur / tote betting): winners split the losing pool pro rata.
contract BlindspotMarkets {
    // ───────────────────────────── Types ─────────────────────────────

    struct Market {
        address creator;
        uint64 closeTime; // betting ends; sealed sides may start being revealed
        uint64 revealDeadline; // sealer key + reveals must land before this
        uint64 resolveDeadline; // no final outcome by this => Invalid (refunds)
        bytes32 sealerKeyHash; // keccak256(ML-KEM-1024 secret key)
        bytes32 councilKeyHash; // keccak256(ML-DSA-87 public key)
    }

    // ──────────────────────────── Constants ───────────────────────────

    uint256 public constant MLKEM1024_PUBKEY_LEN = 1568;
    uint256 public constant MLKEM1024_SECRETKEY_LEN = 3168;
    uint256 public constant MLDSA87_PUBKEY_LEN = 2592;

    uint256 public constant MIN_REVEAL_WINDOW = 10 minutes;
    uint256 public constant MAX_FEE_BPS = 500; // 5%

    // ───────────────────────────── Storage ────────────────────────────

    address public owner;
    address public treasury;
    uint16 public feeBps;

    uint256 public marketCount;
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => string) public question;

    // ───────────────────────────── Events ─────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        uint64 closeTime,
        uint64 revealDeadline,
        uint64 resolveDeadline,
        bytes sealerPublicKey,
        bytes councilPublicKey
    );
    event FeeConfigUpdated(address treasury, uint16 feeBps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ───────────────────────────── Errors ─────────────────────────────

    error NotOwner();
    error InvalidFee();
    error InvalidAddress();
    error InvalidSchedule();
    error InvalidKey();
    error EmptyQuestion();
    error UnknownMarket();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address treasury_, uint16 feeBps_) {
        if (treasury_ == address(0)) revert InvalidAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        owner = msg.sender;
        treasury = treasury_;
        feeBps = feeBps_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeConfigUpdated(treasury_, feeBps_);
    }

    // ─────────────────────────── Market creation ──────────────────────

    /// @notice Open a new sealed market. Permissionless.
    /// @param q                The question, e.g. "Will BTC close above $150k on Dec 31?"
    /// @param closeTime        When betting stops.
    /// @param revealDeadline   Sealer key + reveals must land before this (>= close + 10 min).
    /// @param resolveDeadline  Final outcome must land before this or the market is Invalid.
    /// @param sealerPublicKey  ML-KEM-1024 public key bettors encrypt their side to (1568 bytes).
    /// @param sealerKeyHash    keccak256 of the matching ML-KEM-1024 secret key (released after close).
    /// @param councilPublicKey ML-DSA-87 public key of the resolution council (2592 bytes).
    function createMarket(
        string calldata q,
        uint64 closeTime,
        uint64 revealDeadline,
        uint64 resolveDeadline,
        bytes calldata sealerPublicKey,
        bytes32 sealerKeyHash,
        bytes calldata councilPublicKey
    ) external returns (uint256 marketId) {
        if (bytes(q).length == 0) revert EmptyQuestion();
        if (closeTime <= block.timestamp) revert InvalidSchedule();
        if (revealDeadline < uint256(closeTime) + MIN_REVEAL_WINDOW) revert InvalidSchedule();
        if (resolveDeadline < revealDeadline) revert InvalidSchedule();
        if (sealerPublicKey.length != MLKEM1024_PUBKEY_LEN || sealerKeyHash == bytes32(0)) {
            revert InvalidKey();
        }
        if (councilPublicKey.length != MLDSA87_PUBKEY_LEN) revert InvalidKey();

        marketId = ++marketCount;
        _markets[marketId] = Market({
            creator: msg.sender,
            closeTime: closeTime,
            revealDeadline: revealDeadline,
            resolveDeadline: resolveDeadline,
            sealerKeyHash: sealerKeyHash,
            councilKeyHash: keccak256(councilPublicKey)
        });
        question[marketId] = q;

        emit MarketCreated(
            marketId, msg.sender, q, closeTime, revealDeadline, resolveDeadline, sealerPublicKey, councilPublicKey
        );
    }

    // ─────────────────────────────── Views ────────────────────────────

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    // ─────────────────────────────── Admin ────────────────────────────

    function setFeeConfig(address treasury_, uint16 feeBps_) external onlyOwner {
        if (treasury_ == address(0)) revert InvalidAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeConfigUpdated(treasury_, feeBps_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ───────────────────────────── Internal ───────────────────────────

    function _market(uint256 marketId) internal view returns (Market storage m) {
        m = _markets[marketId];
        if (m.creator == address(0)) revert UnknownMarket();
    }
}
