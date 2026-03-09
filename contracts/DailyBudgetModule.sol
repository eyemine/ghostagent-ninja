// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool);
    function isOwner(address owner) external view returns (bool);
    function getThreshold() external view returns (uint256);
}

/**
 * DailyBudgetModule — Safe Module
 *
 * Enforces a daily xDAI spend cap on a Gnosis Safe.
 * - Tracks cumulative spend per UTC day in contract storage
 * - Reverts any execTransactionFromModule call that would exceed the cap
 * - Owner (or Safe itself) can pause/unpause and reset budget
 * - Emits events consumed by GlassBox audit trail
 *
 * Deploy: one per agent Safe
 * Enable: Safe → Settings → Modules → Add Module → <deployed address>
 */
contract DailyBudgetModule {
    // ── State ────────────────────────────────────────────────────────────────

    address public immutable safe;
    uint256 public dailyCap;          // in wei (xDAI)
    bool    public paused;

    uint256 public currentDay;        // UTC day index (block.timestamp / 86400)
    uint256 public spentToday;        // cumulative spend this UTC day (wei)
    uint256 public alertThreshold;    // basis points (8000 = 80%)

    // ── Events ───────────────────────────────────────────────────────────────

    event SpendRecorded(uint256 amount, uint256 spentToday, uint256 dailyCap, uint256 day);
    event BudgetExhausted(uint256 day);
    event BudgetAlert(uint256 spentToday, uint256 dailyCap, uint256 bps);
    event DailyCapUpdated(uint256 oldCap, uint256 newCap);
    event Paused(address by);
    event Unpaused(address by);
    event BudgetReset(uint256 day);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlySafe() {
        require(msg.sender == safe, "DailyBudgetModule: caller is not the Safe");
        _;
    }

    modifier notPaused() {
        require(!paused, "DailyBudgetModule: agent paused — budget exhausted");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(address _safe, uint256 _dailyCap, uint256 _alertThresholdBps) {
        require(_safe != address(0), "invalid safe");
        require(_dailyCap > 0, "cap must be > 0");
        safe = _safe;
        dailyCap = _dailyCap;
        alertThreshold = _alertThresholdBps == 0 ? 8000 : _alertThresholdBps;
        currentDay = block.timestamp / 86400;
    }

    // ── Core: guarded execution ───────────────────────────────────────────────

    /**
     * Execute a transaction through the Safe, subject to the daily budget cap.
     * Called by the agent's off-chain executor (Cloudflare Worker) via Safe SDK.
     */
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation
    ) external notPaused returns (bool) {
        require(ISafe(safe).isOwner(msg.sender) || msg.sender == safe, "not authorised");

        _rollDayIfNeeded();

        uint256 newSpend = spentToday + value;
        require(newSpend <= dailyCap, "DailyBudgetModule: daily cap exceeded");

        spentToday = newSpend;
        emit SpendRecorded(value, spentToday, dailyCap, currentDay);

        // Emit alert at threshold
        uint256 bps = (spentToday * 10000) / dailyCap;
        if (bps >= alertThreshold) {
            emit BudgetAlert(spentToday, dailyCap, bps);
        }

        // Auto-pause if exactly at cap
        if (spentToday == dailyCap) {
            paused = true;
            emit BudgetExhausted(currentDay);
        }

        bool success = ISafe(safe).execTransactionFromModule(to, value, data, operation);
        require(success, "DailyBudgetModule: Safe execution failed");
        return true;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setDailyCap(uint256 newCap) external onlySafe {
        require(newCap > 0, "cap must be > 0");
        emit DailyCapUpdated(dailyCap, newCap);
        dailyCap = newCap;
    }

    function setAlertThreshold(uint256 bps) external onlySafe {
        require(bps <= 10000, "bps out of range");
        alertThreshold = bps;
    }

    /** Reset budget + unpause. Requires Safe multi-sig (onlySafe). */
    function resetBudget() external onlySafe {
        _rollDayIfNeeded();
        spentToday = 0;
        paused = false;
        emit BudgetReset(currentDay);
        emit Unpaused(msg.sender);
    }

    function pause() external onlySafe {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlySafe {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function remainingToday() external view returns (uint256) {
        uint256 day = block.timestamp / 86400;
        if (day != currentDay) return dailyCap;
        return dailyCap > spentToday ? dailyCap - spentToday : 0;
    }

    function budgetBps() external view returns (uint256) {
        if (dailyCap == 0) return 0;
        uint256 day = block.timestamp / 86400;
        if (day != currentDay) return 0;
        return (spentToday * 10000) / dailyCap;
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _rollDayIfNeeded() internal {
        uint256 day = block.timestamp / 86400;
        if (day != currentDay) {
            currentDay = day;
            spentToday = 0;
            if (paused) {
                paused = false;
                emit Unpaused(address(0));
            }
        }
    }
}
