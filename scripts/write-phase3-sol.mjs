import { writeFileSync } from 'fs';

// ── X402EscrowModule.sol ──────────────────────────────────────────────────────
const X402_ESCROW = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title X402EscrowModule
/// @notice Gnosis Safe module — x402 payment escrow.
///
/// Flow:
///   1. Payer calls escrowPayment(agentId, taskId) with ETH/xDAI
///   2. PaperclipModule verifies TEE proof → calls releasePayment()
///   3. On timeout or failure → refundEscrow()
///
/// Compatible with the x402 HTTP payment protocol.
/// Released funds go to the agent Safe address registered at escrow time.

import "@openzeppelin/contracts/access/Ownable.sol";

contract X402EscrowModule is Ownable {

    uint256 public constant ESCROW_TIMEOUT = 7 days;

    struct Escrow {
        bytes32 taskId;
        uint256 agentId;
        address payer;
        address payable agentSafe;
        uint256 amount;
        uint256 createdAt;
        bool    released;
        bool    refunded;
    }

    mapping(bytes32 => Escrow) public escrows;   // key: taskId
    bytes32[] public taskIds;

    address public paperclipModule;  // authorised to call releasePayment

    event PaymentEscrowed(
        bytes32 indexed taskId,
        uint256 indexed agentId,
        address indexed payer,
        address agentSafe,
        uint256 amount,
        uint256 timestamp
    );

    event PaymentReleased(
        bytes32 indexed taskId,
        uint256 indexed agentId,
        address agentSafe,
        uint256 amount,
        uint256 timestamp
    );

    event EscrowRefunded(
        bytes32 indexed taskId,
        address indexed payer,
        uint256 amount,
        string  reason,
        uint256 timestamp
    );

    constructor(address _paperclipModule) Ownable(msg.sender) {
        paperclipModule = _paperclipModule;
    }

    // ── Escrow ────────────────────────────────────────────────────────────────

    function escrowPayment(
        uint256 agentId,
        bytes32 taskId,
        address payable agentSafe
    ) external payable {
        require(msg.value > 0,                   "No value sent");
        require(agentSafe != address(0),         "Invalid agent safe");
        require(escrows[taskId].createdAt == 0,  "Task already escrowed");

        escrows[taskId] = Escrow({
            taskId:    taskId,
            agentId:   agentId,
            payer:     msg.sender,
            agentSafe: agentSafe,
            amount:    msg.value,
            createdAt: block.timestamp,
            released:  false,
            refunded:  false
        });
        taskIds.push(taskId);

        emit PaymentEscrowed(taskId, agentId, msg.sender, agentSafe, msg.value, block.timestamp);
    }

    // ── Release ───────────────────────────────────────────────────────────────

    /// @notice Called by PaperclipModule after verifyCompute() succeeds.
    function releasePayment(bytes32 taskId) external {
        require(
            msg.sender == paperclipModule || msg.sender == owner(),
            "Only PaperclipModule or owner"
        );
        Escrow storage e = escrows[taskId];
        require(e.createdAt != 0,  "Unknown task");
        require(!e.released,       "Already released");
        require(!e.refunded,       "Already refunded");

        e.released = true;
        uint256 amt = e.amount;

        (bool ok,) = e.agentSafe.call{value: amt}("");
        require(ok, "Transfer failed");

        emit PaymentReleased(taskId, e.agentId, e.agentSafe, amt, block.timestamp);
    }

    // ── Refund ────────────────────────────────────────────────────────────────

    /// @notice Refund payer on timeout or explicit failure.
    function refundEscrow(bytes32 taskId, string calldata reason) external {
        Escrow storage e = escrows[taskId];
        require(e.createdAt != 0,  "Unknown task");
        require(!e.released,       "Already released");
        require(!e.refunded,       "Already refunded");
        require(
            msg.sender == e.payer ||
            msg.sender == owner() ||
            block.timestamp >= e.createdAt + ESCROW_TIMEOUT,
            "Not authorised or not timed out"
        );

        e.refunded = true;
        uint256 amt = e.amount;

        (bool ok,) = payable(e.payer).call{value: amt}("");
        require(ok, "Refund failed");

        emit EscrowRefunded(taskId, e.payer, amt, reason, block.timestamp);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getEscrow(bytes32 taskId) external view returns (Escrow memory) {
        return escrows[taskId];
    }

    function isTimedOut(bytes32 taskId) external view returns (bool) {
        Escrow storage e = escrows[taskId];
        return e.createdAt != 0 && block.timestamp >= e.createdAt + ESCROW_TIMEOUT;
    }

    function setPaperclipModule(address m) external onlyOwner {
        paperclipModule = m;
    }

    receive() external payable {}
}
`;

// ── SwarmMemberModule.sol ─────────────────────────────────────────────────────
const SWARM_MEMBER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SwarmMemberModule
/// @notice Gnosis Safe module — swarm member management with 7-day timelock.
///
/// All membership changes are queued with a 7-day delay before execution.
/// This prevents sudden swarm takeovers and gives members time to exit.

import "@openzeppelin/contracts/access/Ownable.sol";

contract SwarmMemberModule is Ownable {

    uint256 public constant TIMELOCK = 7 days;
    uint256 public constant MAX_MEMBERS = 8;

    struct PendingChange {
        address picoclawAddress;
        bool    isAdd;          // true = add, false = remove
        uint256 queuedAt;
        bool    executed;
        bool    cancelled;
        string  agentName;
    }

    address public safe;
    address[] public members;
    mapping(address => bool) public isMember;
    mapping(address => string) public memberName;

    bytes32[] public pendingIds;
    mapping(bytes32 => PendingChange) public pending;

    event MemberQueued(
        bytes32 indexed changeId,
        address indexed picoclawAddress,
        bool    isAdd,
        string  agentName,
        uint256 executableAt
    );

    event MemberAdded(
        bytes32 indexed changeId,
        address indexed picoclawAddress,
        string  agentName,
        uint256 timestamp
    );

    event MemberRemoved(
        bytes32 indexed changeId,
        address indexed picoclawAddress,
        string  agentName,
        uint256 timestamp
    );

    event ChangeCancelled(bytes32 indexed changeId, uint256 timestamp);

    constructor(address _safe) Ownable(msg.sender) {
        require(_safe != address(0), "Invalid safe");
        safe = _safe;
    }

    // ── Queue ─────────────────────────────────────────────────────────────────

    function queueAddMember(address picoclawAddress, string calldata agentName) external onlyOwner returns (bytes32 changeId) {
        require(!isMember[picoclawAddress],    "Already a member");
        require(members.length < MAX_MEMBERS,  "Swarm full");
        require(picoclawAddress != address(0), "Invalid address");

        changeId = keccak256(abi.encodePacked(picoclawAddress, true, block.timestamp));
        pending[changeId] = PendingChange({
            picoclawAddress: picoclawAddress,
            isAdd:           true,
            queuedAt:        block.timestamp,
            executed:        false,
            cancelled:       false,
            agentName:       agentName
        });
        pendingIds.push(changeId);

        emit MemberQueued(changeId, picoclawAddress, true, agentName, block.timestamp + TIMELOCK);
    }

    function queueRemoveMember(address picoclawAddress) external onlyOwner returns (bytes32 changeId) {
        require(isMember[picoclawAddress], "Not a member");

        changeId = keccak256(abi.encodePacked(picoclawAddress, false, block.timestamp));
        pending[changeId] = PendingChange({
            picoclawAddress: picoclawAddress,
            isAdd:           false,
            queuedAt:        block.timestamp,
            executed:        false,
            cancelled:       false,
            agentName:       memberName[picoclawAddress]
        });
        pendingIds.push(changeId);

        emit MemberQueued(changeId, picoclawAddress, false, memberName[picoclawAddress], block.timestamp + TIMELOCK);
    }

    // ── Execute ───────────────────────────────────────────────────────────────

    function executeChange(bytes32 changeId) external {
        PendingChange storage c = pending[changeId];
        require(c.queuedAt != 0,                             "Unknown change");
        require(!c.executed && !c.cancelled,                 "Already done");
        require(block.timestamp >= c.queuedAt + TIMELOCK,    "Timelock active");

        c.executed = true;

        if (c.isAdd) {
            isMember[c.picoclawAddress]  = true;
            memberName[c.picoclawAddress] = c.agentName;
            members.push(c.picoclawAddress);
            emit MemberAdded(changeId, c.picoclawAddress, c.agentName, block.timestamp);
        } else {
            isMember[c.picoclawAddress] = false;
            for (uint256 i = 0; i < members.length; i++) {
                if (members[i] == c.picoclawAddress) {
                    members[i] = members[members.length - 1];
                    members.pop();
                    break;
                }
            }
            emit MemberRemoved(changeId, c.picoclawAddress, c.agentName, block.timestamp);
        }
    }

    function cancelChange(bytes32 changeId) external onlyOwner {
        PendingChange storage c = pending[changeId];
        require(!c.executed && !c.cancelled, "Already done");
        c.cancelled = true;
        emit ChangeCancelled(changeId, block.timestamp);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getMemberCount() external view returns (uint256) { return members.length; }
    function getMembers() external view returns (address[] memory) { return members; }
    function timeUntilExecutable(bytes32 changeId) external view returns (uint256) {
        PendingChange storage c = pending[changeId];
        uint256 execAt = c.queuedAt + TIMELOCK;
        return block.timestamp >= execAt ? 0 : execAt - block.timestamp;
    }
}
`;

// ── ERC8004OracleModule.sol ───────────────────────────────────────────────────
const ERC8004_ORACLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC8004OracleModule
/// @notice Calls giveFeedback() on the ERC-8004 Reputation Registry
///         after Paperclip attestation verification.
///
/// Translates paperclipScore (0-1000) into an ERC-8004 feedback call.
/// Glass Box events allow notapaperclip.red to display live reputation.

import "@openzeppelin/contracts/access/Ownable.sol";

interface IReputationRegistry {
    function giveFeedback(uint256 agentId, int8 score, string calldata comment) external;
    function getReputation(uint256 agentId) external view returns (int256);
}

contract ERC8004OracleModule is Ownable {

    IReputationRegistry public reputationRegistry;
    address public paperclipModule;   // authorised caller

    struct ReputationRecord {
        uint256 agentId;
        uint256 paperclipScore;   // 0-1000
        int8    feedback;         // ERC-8004 feedback value
        bytes32 proofHash;
        uint256 timestamp;
    }

    mapping(uint256 => ReputationRecord[]) public history;  // agentId → records
    mapping(uint256 => uint256) public latestScore;         // agentId → latest paperclipScore

    event ReputationUpdated(
        uint256 indexed agentId,
        uint256 paperclipScore,
        int8    feedback,
        bytes32 proofHash,
        uint256 timestamp
    );

    event ReputationRegistrySet(address registry, uint256 timestamp);

    constructor(address _reputationRegistry, address _paperclipModule) Ownable(msg.sender) {
        require(_reputationRegistry != address(0), "Invalid registry");
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        paperclipModule    = _paperclipModule;
    }

    // ── Update ────────────────────────────────────────────────────────────────

    /// @notice Convert paperclipScore (0-1000) to ERC-8004 feedback and submit.
    /// @param agentId        ERC-8004 agent token ID
    /// @param paperclipScore 0-1000 from Paperclip TEE verification
    /// @param proofHash      PaperclipModule proofHash for audit linkage
    function updateReputation(
        uint256 agentId,
        uint256 paperclipScore,
        bytes32 proofHash
    ) external {
        require(
            msg.sender == paperclipModule || msg.sender == owner(),
            "Only PaperclipModule or owner"
        );
        require(paperclipScore <= 1000, "Score out of range");

        // Map 0-1000 → ERC-8004 feedback: negative (<400) / neutral (400-600) / positive (>600)
        int8 feedback;
        if (paperclipScore >= 700) {
            feedback = 1;   // positive
        } else if (paperclipScore >= 400) {
            feedback = 0;   // neutral
        } else {
            feedback = -1;  // negative
        }

        string memory comment = string(abi.encodePacked(
            "Paperclip TEE score: ", _toString(paperclipScore), "/1000 | proof: ", _toHex(proofHash)
        ));

        reputationRegistry.giveFeedback(agentId, feedback, comment);

        latestScore[agentId] = paperclipScore;
        history[agentId].push(ReputationRecord({
            agentId:        agentId,
            paperclipScore: paperclipScore,
            feedback:       feedback,
            proofHash:      proofHash,
            timestamp:      block.timestamp
        }));

        emit ReputationUpdated(agentId, paperclipScore, feedback, proofHash, block.timestamp);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getOnChainReputation(uint256 agentId) external view returns (int256) {
        return reputationRegistry.getReputation(agentId);
    }

    function getHistoryLength(uint256 agentId) external view returns (uint256) {
        return history[agentId].length;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setReputationRegistry(address r) external onlyOwner {
        reputationRegistry = IReputationRegistry(r);
        emit ReputationRegistrySet(r, block.timestamp);
    }

    function setPaperclipModule(address m) external onlyOwner {
        paperclipModule = m;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 temp = v; uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    function _toHex(bytes32 b) internal pure returns (string memory) {
        bytes memory hex_ = "0123456789abcdef";
        bytes memory s = new bytes(10); // "0x" + 8 chars
        s[0] = "0"; s[1] = "x";
        for (uint256 i = 0; i < 4; i++) {
            s[2 + i*2] = hex_[uint8(b[i]) >> 4];
            s[3 + i*2] = hex_[uint8(b[i]) & 0xf];
        }
        return string(s);
    }
}
`;

// ── Write all ─────────────────────────────────────────────────────────────────
const files = {
  '/Users/richieogorman/CascadeProjects/ghostagent_ninja/src/X402EscrowModule.sol':   X402_ESCROW,
  '/Users/richieogorman/CascadeProjects/ghostagent_ninja/src/SwarmMemberModule.sol':  SWARM_MEMBER,
  '/Users/richieogorman/CascadeProjects/ghostagent_ninja/src/ERC8004OracleModule.sol': ERC8004_ORACLE,
};

for (const [path, content] of Object.entries(files)) {
  writeFileSync(path, content);
  console.log('✓', path.split('/').pop());
}
