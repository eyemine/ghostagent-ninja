// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IGnosisSafe } from "./interfaces/IGnosisSafe.sol";

/// @title SwarmCoordinatorModule
/// @notice Installed as a module on a vault.gno Safe.
///         Receives task assignments (emitted as events, relayed to CF worker)
///         and distributes them to registered picoclaw.gno agent modules
///         using round-robin with load balancing (skip busy agents).
///
/// Email routing:  swarm.[client]_@nftmail.box → CF worker → assignTask()
/// Worker reads:   nextAssignee() to pick agent, then stores assignment in KV
/// Agent completes: completeTask() → emits TaskCompleted for Glass Box audit
contract SwarmCoordinatorModule is Ownable {

    // ── Structs ───────────────────────────────────────────────────────────────

    struct AgentInfo {
        string  agentName;      // e.g. "pico-scout"
        address moduleAddress;  // Safe module address for this picoclaw agent
        bool    active;
        uint256 activeTasks;
        uint256 completedTasks;
        uint256 addedAt;
    }

    struct TaskRecord {
        bytes32 taskId;
        string  assignedAgent;
        string  topic;
        bytes32 payloadHash;    // keccak256(payload) — never stores cleartext
        uint256 assignedAt;
        bool    completed;
        uint256 completedAt;
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    address public vaultSafe;
    string  public vaultName;   // e.g. "acme"

    string[] public agentNames;
    mapping(string => AgentInfo) public agents;

    bytes32[] public taskIds;
    mapping(bytes32 => TaskRecord) public tasks;

    uint256 private _rrIndex;   // round-robin cursor

    uint256 public constant MAX_AGENTS     = 8;
    uint256 public constant MAX_LOAD       = 5;  // skip agent if activeTasks >= MAX_LOAD

    // ── Events ────────────────────────────────────────────────────────────────

    event AgentRegistered(string indexed agentName, address moduleAddress, uint256 timestamp);
    event AgentRemoved(string indexed agentName, uint256 timestamp);

    event TaskAssigned(
        bytes32 indexed taskId,
        string  indexed assignedAgent,
        string  topic,
        bytes32 payloadHash,
        uint256 timestamp
    );

    event TaskCompleted(
        bytes32 indexed taskId,
        string  indexed assignedAgent,
        bytes32 resultHash,
        uint256 timestamp
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address _vaultSafe, string memory _vaultName) Ownable(msg.sender) {
        require(_vaultSafe != address(0), "Invalid safe");
        vaultSafe  = _vaultSafe;
        vaultName  = _vaultName;
    }

    // ── Agent management ──────────────────────────────────────────────────────

    function addAgent(string calldata agentName, address moduleAddress) external onlyOwner {
        require(bytes(agentName).length > 0,   "Empty name");
        require(moduleAddress != address(0),    "Invalid address");
        require(!agents[agentName].active,      "Already registered");
        require(agentNames.length < MAX_AGENTS, "Swarm full");

        agents[agentName] = AgentInfo({
            agentName:      agentName,
            moduleAddress:  moduleAddress,
            active:         true,
            activeTasks:    0,
            completedTasks: 0,
            addedAt:        block.timestamp
        });
        agentNames.push(agentName);
        emit AgentRegistered(agentName, moduleAddress, block.timestamp);
    }

    function removeAgent(string calldata agentName) external onlyOwner {
        require(agents[agentName].active, "Not registered");
        agents[agentName].active = false;
        emit AgentRemoved(agentName, block.timestamp);
    }

    // ── Task distribution ─────────────────────────────────────────────────────

    /// @notice Pick next available agent using round-robin + load balancing.
    /// @return agentName  Empty string if no agent available.
    function nextAssignee() public view returns (string memory agentName) {
        uint256 n = agentNames.length;
        if (n == 0) return '';
        for (uint256 i = 0; i < n; i++) {
            uint256 idx = (_rrIndex + i) % n;
            string memory name = agentNames[idx];
            AgentInfo storage a = agents[name];
            if (a.active && a.activeTasks < MAX_LOAD) {
                return name;
            }
        }
        return ''; // all agents busy
    }

    /// @notice Assign a task. Called by the vault Safe (via Brain module relay).
    /// @param topic       Human-readable task label (e.g. "parse-email")
    /// @param payloadHash keccak256 of the task payload — never stores cleartext
    function assignTask(
        string calldata topic,
        bytes32 payloadHash
    ) external returns (bytes32 taskId, string memory assignedAgent) {
        require(
            msg.sender == vaultSafe || msg.sender == owner(),
            "Only vault Safe or owner"
        );

        assignedAgent = nextAssignee();
        require(bytes(assignedAgent).length > 0, "No available agents");

        taskId = keccak256(abi.encodePacked(topic, payloadHash, block.timestamp, _rrIndex));

        tasks[taskId] = TaskRecord({
            taskId:       taskId,
            assignedAgent: assignedAgent,
            topic:        topic,
            payloadHash:  payloadHash,
            assignedAt:   block.timestamp,
            completed:    false,
            completedAt:  0
        });
        taskIds.push(taskId);

        agents[assignedAgent].activeTasks++;

        // Advance round-robin cursor to index after selected agent
        for (uint256 i = 0; i < agentNames.length; i++) {
            if (keccak256(bytes(agentNames[i])) == keccak256(bytes(assignedAgent))) {
                _rrIndex = (i + 1) % agentNames.length;
                break;
            }
        }

        emit TaskAssigned(taskId, assignedAgent, topic, payloadHash, block.timestamp);
    }

    /// @notice Mark task complete. Called by the assigned agent module.
    /// @param resultHash keccak256 of result — stored for Glass Box audit
    function completeTask(bytes32 taskId, bytes32 resultHash) external {
        TaskRecord storage t = tasks[taskId];
        require(t.taskId != bytes32(0),  "Unknown task");
        require(!t.completed,            "Already completed");

        AgentInfo storage a = agents[t.assignedAgent];
        require(
            msg.sender == a.moduleAddress || msg.sender == owner(),
            "Only assigned agent"
        );

        t.completed   = true;
        t.completedAt = block.timestamp;
        if (a.activeTasks > 0) a.activeTasks--;
        a.completedTasks++;

        emit TaskCompleted(taskId, t.assignedAgent, resultHash, block.timestamp);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getAgentCount() external view returns (uint256 total, uint256 active) {
        total = agentNames.length;
        for (uint256 i = 0; i < agentNames.length; i++) {
            if (agents[agentNames[i]].active) active++;
        }
    }

    function getTaskCount() external view returns (uint256 total, uint256 pending) {
        total = taskIds.length;
        for (uint256 i = 0; i < taskIds.length; i++) {
            if (!tasks[taskIds[i]].completed) pending++;
        }
    }
}
