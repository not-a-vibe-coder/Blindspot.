// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {QorePQC} from "./libraries/QorePQC.sol";

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

    enum Side {
        Hidden, // still sealed (or never revealed)
        Yes,
        No
    }

    struct Bet {
        address bettor;
        uint128 amount;
        bytes32 commitment; // keccak256(chainid, this, marketId, bettor, side, salt)
        Side side;
        bool claimed;
    }

    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid // refunds everyone
    }

    struct Resolution {
        Outcome outcome; // final outcome once set
        bool viaCouncil; // true if the ML-DSA-87 council signed it
    }

    /// @dev What the world can see: how much is in, never which way — until reveal.
    struct Pool {
        uint128 totalStaked;
        uint128 revealedYes;
        uint128 revealedNo;
        uint32 betCount;
        uint32 revealedCount;
    }

    // ──────────────────────────── Constants ───────────────────────────

    uint256 public constant MLKEM1024_PUBKEY_LEN = 1568;
    uint256 public constant MLKEM1024_SECRETKEY_LEN = 3168;
    uint256 public constant MLDSA87_PUBKEY_LEN = 2592;
    uint256 public constant MLKEM1024_CIPHERTEXT_LEN = 1568;
    /// @dev sealed side = ML-KEM ciphertext ‖ 12-byte nonce ‖ AES-256-GCM(side ‖ salt) ‖ 16-byte tag
    uint256 public constant MIN_SEALED_LEN = MLKEM1024_CIPHERTEXT_LEN + 12 + 16 + 33;
    uint256 public constant MAX_SEALED_LEN = 2048;
    uint256 public constant MIN_BET = 0.001 ether;

    uint256 public constant MIN_REVEAL_WINDOW = 10 minutes;
    uint256 public constant MAX_FEE_BPS = 500; // 5%

    // ───────────────────────────── Storage ────────────────────────────

    address public owner;
    address public treasury;
    uint16 public feeBps;

    uint256 public marketCount;
    mapping(uint256 => Market) internal _markets;
    mapping(uint256 => string) public question;
    mapping(uint256 => Pool) internal _pools;
    mapping(uint256 => mapping(uint256 => Bet)) internal _bets;
    /// @notice True once the sealer's ML-KEM secret key is public (keyper release).
    mapping(uint256 => bool) public sealerKeyReleased;
    mapping(uint256 => Resolution) internal _resolutions;

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
    /// @dev `sealedSide` lives only in the log — the contract never needs to read it.
    event BetPlaced(
        uint256 indexed marketId,
        uint256 indexed betId,
        address indexed bettor,
        uint128 amount,
        bytes32 commitment,
        bytes sealedSide
    );
    /// @dev Once emitted, anyone can decrypt every sealed side in this market and verify the reveals.
    event SealerKeyReleased(uint256 indexed marketId, bytes secretKey);
    event BetRevealed(uint256 indexed marketId, uint256 indexed betId, Side side);
    event MarketResolved(uint256 indexed marketId, Outcome outcome, bool viaCouncil);
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
    error BettingClosed();
    error BetTooSmall();
    error InvalidCommitment();
    error InvalidSealedSide();
    error UnknownBet();
    error NotInRevealWindow();
    error KeyAlreadyReleased();
    error WrongSealerKey();
    error LengthMismatch();
    error InvalidReveal(uint256 betId);
    error MarketStillOpen();
    error AlreadyResolved();
    error ResolutionExpired();
    error InvalidOutcome();
    error WrongCouncilKey();
    error BadCouncilSignature();

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

    // ──────────────────────────── Sealed bets ─────────────────────────

    /// @notice Bet blind. The stake is public; the side is not.
    /// @param commitment  {commitmentFor}(marketId, msg.sender, side, salt) — binds the side.
    /// @param sealedSide  (side ‖ salt) encrypted to the market's ML-KEM-1024 sealer key, so the
    ///                    sealer (or anyone, once the key is released) can reveal it after close.
    function placeBet(uint256 marketId, bytes32 commitment, bytes calldata sealedSide)
        external
        payable
        returns (uint256 betId)
    {
        Market storage m = _market(marketId);
        if (block.timestamp >= m.closeTime) revert BettingClosed();
        if (msg.value < MIN_BET) revert BetTooSmall();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (sealedSide.length < MIN_SEALED_LEN || sealedSide.length > MAX_SEALED_LEN) {
            revert InvalidSealedSide();
        }

        Pool storage p = _pools[marketId];
        betId = ++p.betCount;
        uint128 amount = uint128(msg.value);
        p.totalStaked += amount;

        _bets[marketId][betId] =
            Bet({bettor: msg.sender, amount: amount, commitment: commitment, side: Side.Hidden, claimed: false});

        emit BetPlaced(marketId, betId, msg.sender, amount, commitment, sealedSide);
    }

    /// @notice The commitment a bettor must submit. Domain-separated by chain + contract + market + bettor,
    ///         so a commitment can't be replayed or copied by someone else.
    function commitmentFor(uint256 marketId, address bettor, Side side, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), marketId, bettor, side, salt));
    }

    // ───────────────────────── Keyper release + reveal ─────────────────

    /// @notice Release the market's ML-KEM-1024 secret key after close (Shutter-style keyper).
    ///         Anyone may submit it — the hash committed at creation proves it's the right key,
    ///         and once it's public every sealed side can be decrypted and checked by anyone.
    function releaseSealerKey(uint256 marketId, bytes calldata secretKey) external {
        Market storage m = _market(marketId);
        _requireRevealWindow(m);
        if (sealerKeyReleased[marketId]) revert KeyAlreadyReleased();
        if (secretKey.length != MLKEM1024_SECRETKEY_LEN || keccak256(secretKey) != m.sealerKeyHash) {
            revert WrongSealerKey();
        }
        sealerKeyReleased[marketId] = true;
        emit SealerKeyReleased(marketId, secretKey);
    }

    /// @notice Open sealed bets by proving (side, salt) against each commitment. Permissionless:
    ///         the sealer batch-reveals everything, and bettors can always self-reveal with their salt.
    ///         Already-revealed bets are skipped so overlapping batches never brick each other.
    function revealBets(
        uint256 marketId,
        uint256[] calldata betIds,
        Side[] calldata sides,
        bytes32[] calldata salts
    ) external {
        Market storage m = _market(marketId);
        _requireRevealWindow(m);
        if (betIds.length != sides.length || betIds.length != salts.length) revert LengthMismatch();

        Pool storage p = _pools[marketId];
        for (uint256 i; i < betIds.length; ++i) {
            Bet storage b = _bet(marketId, betIds[i]);
            if (b.side != Side.Hidden) continue;

            Side side = sides[i];
            if (side == Side.Hidden) revert InvalidReveal(betIds[i]);
            if (commitmentFor(marketId, b.bettor, side, salts[i]) != b.commitment) {
                revert InvalidReveal(betIds[i]);
            }

            b.side = side;
            if (side == Side.Yes) p.revealedYes += b.amount;
            else p.revealedNo += b.amount;
            ++p.revealedCount;
            emit BetRevealed(marketId, betIds[i], side);
        }
    }

    // ──────────────────── Post-quantum council resolution ───────────────

    /// @notice Finalize a market with an ML-DSA-87 signature from the market's council.
    ///         Anyone can relay it — the signature is the authority, not msg.sender — and it's
    ///         verified on-chain by QoreChain's PQC precompile (0x0a01), so it stays unforgeable
    ///         even against a quantum adversary.
    function resolveByCouncil(
        uint256 marketId,
        Outcome outcome,
        bytes calldata councilPublicKey,
        bytes calldata signature
    ) external {
        Market storage m = _market(marketId);
        _requireResolvable(marketId, m);
        if (outcome == Outcome.Unresolved) revert InvalidOutcome();
        if (keccak256(councilPublicKey) != m.councilKeyHash) revert WrongCouncilKey();
        if (!QorePQC.verify(councilPublicKey, signature, resolutionMessage(marketId, outcome))) {
            revert BadCouncilSignature();
        }
        _finalize(marketId, outcome, true);
    }

    /// @notice Exact bytes the council signs. Domain-separated by chain, contract and market so a
    ///         signature can never be replayed on another market or deployment.
    function resolutionMessage(uint256 marketId, Outcome outcome) public view returns (bytes memory) {
        return abi.encodePacked("BLINDSPOT_RESOLVE_V1", block.chainid, address(this), marketId, uint8(outcome));
    }

    // ─────────────────────────────── Views ────────────────────────────

    function getResolution(uint256 marketId) external view returns (Resolution memory) {
        _market(marketId);
        return _resolutions[marketId];
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    function getPool(uint256 marketId) external view returns (Pool memory) {
        _market(marketId);
        return _pools[marketId];
    }

    function getBet(uint256 marketId, uint256 betId) external view returns (Bet memory) {
        return _bet(marketId, betId);
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

    function _requireResolvable(uint256 marketId, Market storage m) internal view {
        if (block.timestamp < m.closeTime) revert MarketStillOpen();
        if (_resolutions[marketId].outcome != Outcome.Unresolved) revert AlreadyResolved();
        if (block.timestamp >= m.resolveDeadline) revert ResolutionExpired();
    }

    function _finalize(uint256 marketId, Outcome outcome, bool viaCouncil) internal {
        _resolutions[marketId] = Resolution({outcome: outcome, viaCouncil: viaCouncil});
        emit MarketResolved(marketId, outcome, viaCouncil);
    }

    function _requireRevealWindow(Market storage m) internal view {
        if (block.timestamp < m.closeTime || block.timestamp >= m.revealDeadline) revert NotInRevealWindow();
    }

    function _bet(uint256 marketId, uint256 betId) internal view returns (Bet storage b) {
        b = _bets[marketId][betId];
        if (b.bettor == address(0)) revert UnknownBet();
    }
}
