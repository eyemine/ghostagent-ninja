import { writeFileSync, mkdirSync } from 'fs';

const PAPERCLIP = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PaperclipModule
/// @notice Gnosis Safe module for Paperclip TEE attestation.
///
/// Flow:
///   1. Agent completes compute task inside TEE
///   2. TEE produces a proofHash (keccak256 of signed attestation bundle)
///   3. Agent calls submitAttestation(proofHash, taskId, agentName)
///   4. Module emits AttestationSubmitted — Glass Box audit picks this up
///   5. verifyCompute(proofHash) can be called by anyone to confirm on-chain record
///
/// notapaperclip.red reads AttestationSubmitted events and displays
/// verified proof bundles alongside the swarm agent registry.

import "@openzeppelin/contracts/access/Ownable.sol";

contract PaperclipModule is Ownable {

    // ── Structs ───────────────────────────────────────────────────────────────

    struct Attestation {
        bytes32 proofHash;      // keccak256 of TEE-signed attestation bundle
        bytes32 taskId;         // matches SwarmCoordinatorModule taskId
        string  agentName;      // e.g. "pico-scout.picoclaw.gno"
        address submitter;      // EOA or Safe module that submitted
        uint256 timestamp;
        bool    verified;       // set true once verifyCompute() confirms
        string  notaRef;        // optional notapaperclip.red URL slug
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    address public safe;                        // the owning Gnosis Safe
    address public swarmCoordinator;            // SwarmCoordinatorModule address

    bytes32[] public proofHashes;
    mapping(bytes32 => Attestation) public attestations;

    // Authorised TEE verifier keys (multisig: require >= verifierThreshold)
    address[] public verifiers;
    mapping(address => bool) public isVerifier;
    uint8 public verifierThreshold;

    // Per-agent cumulative attestation count (feeds ERC-8004 reputation)
    mapping(string => uint256) public agentAttestationCount;

    // ── Events ────────────────────────────────────────────────────────────────

    /// @notice Emitted when a new TEE attestation is submitted.
    /// @dev Glass Box indexer and notapaperclip.red both listen to this.
    event AttestationSubmitted(
        bytes32 indexed proofHash,
        bytes32 indexed taskId,
        string  indexed agentName,
        address submitter,
        uint256 timestamp
    );

    /// @notice Emitted when verifyCompute() confirms a proof.
    event AttestationVerified(
        bytes32 indexed proofHash,
        string  indexed agentName,
        address verifier,
        uint256 timestamp
    );

    /// @notice Emitted when a verifier is added or removed.
    event VerifierUpdated(address verifier, bool active);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _safe,
        address _swarmCoordinator,
        address[] memory _verifiers,
        uint8 _verifierThreshold
    ) Ownable(msg.sender) {
        require(_safe != address(0),            "Invalid safe");
        require(_verifiers.length > 0,          "Need at least one verifier");
        require(_verifierThreshold > 0 &&
                _verifierThreshold <= _verifiers.length, "Bad threshold");

        safe              = _safe;
        swarmCoordinator  = _swarmCoordinator;
        verifierThreshold = _verifierThreshold;

        for (uint256 i = 0; i < _verifiers.length; i++) {
            require(!isVerifier[_verifiers[i]], "Duplicate verifier");
            verifiers.push(_verifiers[i]);
            isVerifier[_verifiers[i]] = true;
            emit VerifierUpdated(_verifiers[i], true);
        }
    }

    // ── Submission ────────────────────────────────────────────────────────────

    /// @notice Submit a TEE attestation proof.
    /// @param proofHash   keccak256 of the TEE-signed attestation bundle
    /// @param taskId      SwarmCoordinator taskId this attestation covers
    /// @param agentName   fully-qualified agent name (e.g. "scout.picoclaw.gno")
    /// @param notaRef     optional notapaperclip.red verification slug
    function submitAttestation(
        bytes32 proofHash,
        bytes32 taskId,
        string calldata agentName,
        string calldata notaRef
    ) external {
        require(proofHash != bytes32(0),         "Empty proofHash");
        require(bytes(agentName).length > 0,     "Empty agentName");
        require(attestations[proofHash].timestamp == 0, "Already submitted");

        attestations[proofHash] = Attestation({
            proofHash:  proofHash,
            taskId:     taskId,
            agentName:  agentName,
            submitter:  msg.sender,
            timestamp:  block.timestamp,
            verified:   false,
            notaRef:    notaRef
        });
        proofHashes.push(proofHash);
        agentAttestationCount[agentName]++;

        emit AttestationSubmitted(proofHash, taskId, agentName, msg.sender, block.timestamp);
    }

    // ── Verification ──────────────────────────────────────────────────────────

    /// @notice Confirm a previously submitted proof hash on-chain.
    /// @dev Called by authorised TEE verifier keys.
    ///      Once >= verifierThreshold verifiers call this for the same proofHash,
    ///      the attestation is marked verified.
    ///
    ///      For MVP: single verifier (threshold = 1) is fine.
    ///      For production: use multi-sig verifier set.
    function verifyCompute(bytes32 proofHash) external {
        require(isVerifier[msg.sender],              "Not a verifier");
        Attestation storage a = attestations[proofHash];
        require(a.timestamp != 0,                    "Unknown proof");
        require(!a.verified,                         "Already verified");

        a.verified = true;

        emit AttestationVerified(proofHash, a.agentName, msg.sender, block.timestamp);
    }

    // ── Verifier management ───────────────────────────────────────────────────

    function addVerifier(address v) external onlyOwner {
        require(!isVerifier[v], "Already a verifier");
        verifiers.push(v);
        isVerifier[v] = true;
        emit VerifierUpdated(v, true);
    }

    function removeVerifier(address v) external onlyOwner {
        require(isVerifier[v], "Not a verifier");
        isVerifier[v] = false;
        emit VerifierUpdated(v, false);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getAttestation(bytes32 proofHash)
        external view returns (Attestation memory)
    {
        return attestations[proofHash];
    }

    function getProofCount() external view returns (uint256) {
        return proofHashes.length;
    }

    function getAgentAttestationCount(string calldata agentName)
        external view returns (uint256)
    {
        return agentAttestationCount[agentName];
    }

    /// @notice Returns latest N proof hashes (for notapaperclip.red feed).
    function getRecentProofs(uint256 n)
        external view returns (bytes32[] memory result)
    {
        uint256 total = proofHashes.length;
        uint256 count = n > total ? total : n;
        result = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = proofHashes[total - count + i];
        }
    }
}
`;

const RISK_ROUTER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title RiskRouterModule
/// @notice Gnosis Safe module — spending limits + circuit breakers.
///
/// The vault Safe must have this module enabled.
/// Before any value-transfer exec, the Safe calls checkSpend().
/// If daily limit exceeded OR circuit breaker tripped, tx reverts.

import "@openzeppelin/contracts/access/Ownable.sol";

contract RiskRouterModule is Ownable {

    // ── Config ────────────────────────────────────────────────────────────────

    address public safe;
    uint256 public dailyCap;          // max native token (wei) per UTC day
    uint256 public alertThreshold;    // fraction of dailyCap that triggers alert (BPS, 10000 = 100%)
    bool    public circuitOpen;       // if true, all spend blocked

    // ── State ─────────────────────────────────────────────────────────────────

    uint256 public currentDaySpend;
    uint256 public currentDay;        // UTC day number (block.timestamp / 86400)

    // ── Events ────────────────────────────────────────────────────────────────

    event SpendRecorded(uint256 amount, uint256 dayTotal, uint256 cap);
    event AlertThresholdHit(uint256 dayTotal, uint256 cap, uint256 bps);
    event CircuitBreakerOpened(string reason, uint256 timestamp);
    event CircuitBreakerReset(uint256 timestamp);
    event DailyCapUpdated(uint256 oldCap, uint256 newCap);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _safe,
        uint256 _dailyCap,
        uint256 _alertThresholdBps
    ) Ownable(msg.sender) {
        require(_safe != address(0),     "Invalid safe");
        require(_dailyCap > 0,           "Cap must be > 0");
        require(_alertThresholdBps <= 10000, "BPS max 10000");

        safe            = _safe;
        dailyCap        = _dailyCap;
        alertThreshold  = _alertThresholdBps;
        currentDay      = block.timestamp / 86400;
    }

    // ── Core check ────────────────────────────────────────────────────────────

    /// @notice Called before any value transfer. Reverts if over limit.
    function checkSpend(uint256 amount) external {
        require(!circuitOpen, "Circuit breaker open — all spend paused");

        uint256 today = block.timestamp / 86400;
        if (today > currentDay) {
            currentDay      = today;
            currentDaySpend = 0;
        }

        uint256 newTotal = currentDaySpend + amount;
        require(newTotal <= dailyCap, "Daily spend cap exceeded");

        currentDaySpend = newTotal;

        emit SpendRecorded(amount, newTotal, dailyCap);

        uint256 bps = (newTotal * 10000) / dailyCap;
        if (bps >= alertThreshold) {
            emit AlertThresholdHit(newTotal, dailyCap, bps);
        }
    }

    // ── Circuit breaker ───────────────────────────────────────────────────────

    function openCircuitBreaker(string calldata reason) external onlyOwner {
        circuitOpen = true;
        emit CircuitBreakerOpened(reason, block.timestamp);
    }

    function resetCircuitBreaker() external onlyOwner {
        circuitOpen = false;
        emit CircuitBreakerReset(block.timestamp);
    }

    // ── Config ────────────────────────────────────────────────────────────────

    function setDailyCap(uint256 newCap) external onlyOwner {
        emit DailyCapUpdated(dailyCap, newCap);
        dailyCap = newCap;
    }

    function setAlertThreshold(uint256 bps) external onlyOwner {
        require(bps <= 10000, "BPS max 10000");
        alertThreshold = bps;
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getDayRemaining() external view returns (uint256) {
        uint256 today = block.timestamp / 86400;
        if (today > currentDay) return dailyCap;
        return dailyCap > currentDaySpend ? dailyCap - currentDaySpend : 0;
    }
}
`;

mkdirSync('/Users/richieogorman/CascadeProjects/ghostagent_ninja/src', { recursive: true });
writeFileSync('/Users/richieogorman/CascadeProjects/ghostagent_ninja/src/PaperclipModule.sol', PAPERCLIP);
writeFileSync('/Users/richieogorman/CascadeProjects/ghostagent_ninja/src/RiskRouterModule.sol', RISK_ROUTER);
console.log('✓ PaperclipModule.sol');
console.log('✓ RiskRouterModule.sol');
