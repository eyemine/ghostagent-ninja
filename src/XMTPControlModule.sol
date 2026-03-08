// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title XMTPControlModule
/// @notice Owner-sovereign toggle for XMTP messaging per agent.
///         PICOCLAW tier is locked off. PUPA+ can toggle freely. IMAGO defaults ON.
///         Emits XMTPStatusChanged for Glass Box indexers.
contract XMTPControlModule is Ownable {

    // ── Tier constants ────────────────────────────────────────────────────────
    uint8 public constant TIER_PICOCLAW = 0; // Larva — XMTP locked off
    uint8 public constant TIER_PUPA     = 1; // Default OFF, owner can toggle
    uint8 public constant TIER_IMAGO    = 2; // Default ON,  owner can toggle

    // ── Storage ───────────────────────────────────────────────────────────────

    /// @notice agentKey (keccak256(name, tld)) → XMTP enabled
    mapping(bytes32 => bool) public xmtpEnabled;

    /// @notice agentKey → tier
    mapping(bytes32 => uint8) public agentTier;

    /// @notice agentKey → registered owner address
    mapping(bytes32 => address) public agentOwner;

    // ── Events ────────────────────────────────────────────────────────────────

    event XMTPStatusChanged(
        bytes32 indexed agentKey,
        string  agentName,
        string  tld,
        bool    enabled,
        address indexed caller,
        uint256 timestamp
    );

    event AgentRegistered(
        bytes32 indexed agentKey,
        string  agentName,
        string  tld,
        uint8   tier,
        address indexed owner
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ── Internal ──────────────────────────────────────────────────────────────

    function _key(string calldata name, string calldata tld) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(name, ".", tld));
    }

    // ── Admin: register agent ─────────────────────────────────────────────────

    /// @notice Register an agent with its tier and owner.
    ///         Called by the registry/mint flow when a new GNS name is minted.
    function registerAgent(
        string calldata name,
        string calldata tld,
        uint8 tier,
        address owner
    ) external onlyOwner {
        bytes32 key = _key(name, tld);
        agentTier[key]  = tier;
        agentOwner[key] = owner;
        // Set default XMTP state by tier
        bool defaultEnabled = (tier == TIER_IMAGO);
        xmtpEnabled[key] = defaultEnabled;
        emit AgentRegistered(key, name, tld, tier, owner);
        emit XMTPStatusChanged(key, name, tld, defaultEnabled, owner, block.timestamp);
    }

    // ── Owner: toggle XMTP ────────────────────────────────────────────────────

    /// @notice Toggle XMTP for an agent. Only callable by the registered agent owner.
    function setXMTPEnabled(
        string calldata name,
        string calldata tld,
        bool enable
    ) external {
        bytes32 key = _key(name, tld);
        require(agentOwner[key] != address(0), "Agent not registered");
        require(agentOwner[key] == msg.sender,  "Not agent owner");
        require(agentTier[key]  != TIER_PICOCLAW, "PICOCLAW: upgrade to PUPA first");

        xmtpEnabled[key] = enable;
        emit XMTPStatusChanged(key, name, tld, enable, msg.sender, block.timestamp);
    }

    // ── Admin: update tier ────────────────────────────────────────────────────

    /// @notice Update an agent's tier (e.g. after a molt).
    function setAgentTier(
        string calldata name,
        string calldata tld,
        uint8 tier
    ) external onlyOwner {
        bytes32 key = _key(name, tld);
        require(agentOwner[key] != address(0), "Agent not registered");
        agentTier[key] = tier;
    }

    // ── View ──────────────────────────────────────────────────────────────────

    function getStatus(string calldata name, string calldata tld)
        external view returns (bool enabled, uint8 tier, address owner)
    {
        bytes32 key = _key(name, tld);
        return (xmtpEnabled[key], agentTier[key], agentOwner[key]);
    }
}
