// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool);
    function isOwner(address owner) external view returns (bool);
}

/**
 * HumanInTheLoopModule - Safe Module
 *
 * High-value transactions (> threshold) are queued and require
 * Safe owner approval before execution. Low-value transactions
 * execute immediately without queuing.
 *
 * Emergency pause: owner can halt all execution instantly.
 */
contract HumanInTheLoopModule {
    // ── State ─────────────────────────────────────────────────────────────────

    address public immutable safe;
    uint256 public threshold;       // wei — transactions above this need approval
    bool    public emergencyPaused;
    uint256 public approvalTtl;     // seconds — pending requests expire after this

    struct PendingTx {
        address to;
        uint256 value;
        bytes   data;
        uint8   operation;
        uint256 createdAt;
        bool    approved;
        bool    executed;
        bool    cancelled;
        address requestedBy;
    }

    mapping(bytes32 => PendingTx) public pending;
    bytes32[] public pendingIds;

    // ── Events ────────────────────────────────────────────────────────────────

    event TransactionQueued(bytes32 indexed txHash, address to, uint256 value, address requestedBy);
    event TransactionApproved(bytes32 indexed txHash, address approvedBy);
    event TransactionExecuted(bytes32 indexed txHash);
    event TransactionCancelled(bytes32 indexed txHash);
    event EmergencyPaused(address by);
    event EmergencyUnpaused(address by);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlySafe() {
        require(msg.sender == safe, "HumanInTheLoop: not Safe");
        _;
    }

    modifier onlyOwner() {
        require(ISafe(safe).isOwner(msg.sender) || msg.sender == safe, "HumanInTheLoop: not owner");
        _;
    }

    modifier notPaused() {
        require(!emergencyPaused, "HumanInTheLoop: emergency paused");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _safe, uint256 _threshold, uint256 _approvalTtlSeconds) {
        require(_safe != address(0), "invalid safe");
        safe = _safe;
        threshold = _threshold;
        approvalTtl = _approvalTtlSeconds == 0 ? 86400 : _approvalTtlSeconds; // default 24h
    }

    // ── Core ──────────────────────────────────────────────────────────────────

    /**
     * Submit a transaction. If value <= threshold, executes immediately.
     * If value > threshold, queues for Safe approval.
     */
    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external notPaused onlyOwner returns (bytes32 txHash) {
        txHash = keccak256(abi.encodePacked(to, value, data, operation, block.timestamp, msg.sender));

        if (value <= threshold) {
            // Low-value: execute immediately
            bool success = ISafe(safe).execTransactionFromModule(to, value, data, operation);
            require(success, "HumanInTheLoop: execution failed");
            emit TransactionExecuted(txHash);
        } else {
            // High-value: queue for approval
            pending[txHash] = PendingTx({
                to: to, value: value, data: data, operation: operation,
                createdAt: block.timestamp, approved: false, executed: false,
                cancelled: false, requestedBy: msg.sender
            });
            pendingIds.push(txHash);
            emit TransactionQueued(txHash, to, value, msg.sender);
        }
    }

    /**
     * Approve and execute a queued transaction. Only Safe multi-sig can call.
     */
    function approveAndExecute(bytes32 txHash) external notPaused onlySafe {
        PendingTx storage tx_ = pending[txHash];
        require(!tx_.executed, "already executed");
        require(!tx_.cancelled, "cancelled");
        require(!tx_.approved, "already approved");
        require(block.timestamp <= tx_.createdAt + approvalTtl, "approval TTL expired");

        tx_.approved = true;
        tx_.executed = true;
        emit TransactionApproved(txHash, msg.sender);

        bool success = ISafe(safe).execTransactionFromModule(tx_.to, tx_.value, tx_.data, tx_.operation);
        require(success, "HumanInTheLoop: Safe execution failed");
        emit TransactionExecuted(txHash);
    }

    function cancelTransaction(bytes32 txHash) external onlyOwner {
        PendingTx storage tx_ = pending[txHash];
        require(!tx_.executed, "already executed");
        require(!tx_.cancelled, "already cancelled");
        tx_.cancelled = true;
        emit TransactionCancelled(txHash);
    }

    // ── Emergency Pause ───────────────────────────────────────────────────────

    function emergencyPause() external onlyOwner {
        emergencyPaused = true;
        emit EmergencyPaused(msg.sender);
    }

    function emergencyUnpause() external onlySafe {
        emergencyPaused = false;
        emit EmergencyUnpaused(msg.sender);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setThreshold(uint256 newThreshold) external onlySafe {
        emit ThresholdUpdated(threshold, newThreshold);
        threshold = newThreshold;
    }

    function setApprovalTtl(uint256 seconds_) external onlySafe {
        approvalTtl = seconds_;
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getPendingCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < pendingIds.length; i++) {
            PendingTx storage t = pending[pendingIds[i]];
            if (!t.executed && !t.cancelled) count++;
        }
        return count;
    }

    function getPendingIds() external view returns (bytes32[] memory ids) {
        uint256 count = 0;
        for (uint256 i = 0; i < pendingIds.length; i++) {
            if (!pending[pendingIds[i]].executed && !pending[pendingIds[i]].cancelled) count++;
        }
        ids = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < pendingIds.length; i++) {
            if (!pending[pendingIds[i]].executed && !pending[pendingIds[i]].cancelled) {
                ids[j++] = pendingIds[i];
            }
        }
    }
}
