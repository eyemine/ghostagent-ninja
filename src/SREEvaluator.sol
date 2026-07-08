// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./utils/IAgentGate.sol";

/**
 * @title SREEvaluator
 * @notice Structural Risk Exposure evaluator for ERC-8217
 * @dev Walks controller graph with cycle detection and classifies based on IAgentGate conformance
 */
contract SREEvaluator {
    error MalformedGraph_CycleDetected();
    error Unresolvable_DepthLimitReached();

    uint256 public constant MAX_DEPTH = 8;
    uint256 public constant MAX_MODULES = 32;
    bytes4 public constant AGENT_GATE_INTERFACE_ID = type(IAgentGate).interfaceId;
    bytes4 public constant ERC721_INTERFACE_ID = 0x80ac58cd;

    enum Classification {
        EOA_ROOTED,          // Traversal ends at EOA
        SAFE_ROOTED,         // Traversal ends at Safe without gating modules
        SAFE_ROOTED_GATED,   // Traversal ends at Safe with at least one IAgentGate module
        UNRESOLVABLE,        // Depth limit reached
        MALFORMED_GRAPH      // Cycle detected
    }

    struct WalkResult {
        Classification classification;
        address root;                    // Final address reached (EOA or Safe)
        uint256 depth;                   // Hops traversed
        bool hasGatingModule;            // Whether root Safe has IAgentGate module
    }

    /**
     * @notice Walk the controller graph starting from an address
     * @param start The starting address (typically an ERC-6551 TBA)
     * @return result WalkResult with classification and metadata
     */
    function walkControllerGraph(address start) external view returns (WalkResult memory result) {
        address current = start;
        address[] memory visited = new address[](MAX_DEPTH + 1);
        uint256 depth = 0;

        while (depth <= MAX_DEPTH) {
            // Cycle detection: check if we've visited this address before
            for (uint256 i = 0; i < depth; i++) {
                if (visited[i] == current) {
                    result.classification = Classification.MALFORMED_GRAPH;
                    return result;
                }
            }

            visited[depth] = current;

            // Check if current address is an EOA (no code)
            uint256 size;
            assembly {
                size := extcodesize(current)
            }
            if (size == 0) {
                result.classification = Classification.EOA_ROOTED;
                result.root = current;
                result.depth = depth;
                return result;
            }

            // Try to get controller/owner
            address next = _getController(current);
            if (next == address(0)) {
                // No controller found - assume this is the root
                result.root = current;
                result.depth = depth;

                // Check for gating modules if it's a Safe
                if (_isSafe(current)) {
                    result.hasGatingModule = _hasGatingModule(current);
                    result.classification = result.hasGatingModule
                        ? Classification.SAFE_ROOTED_GATED
                        : Classification.SAFE_ROOTED;
                } else {
                    result.classification = Classification.SAFE_ROOTED;
                }
                return result;
            }

            current = next;
            depth++;
        }

        // Depth limit reached
        result.classification = Classification.UNRESOLVABLE;
        return result;
    }

    /**
     * @notice Get the controller/owner of an address (CONTROL RAIL ONLY)
     * @dev Tries ERC-6551 TBA.owner(), Safe.owner(), ERC-721.ownerOf()
     * @dev Gas-stipended to prevent griefing attacks
     * @dev ERC-721 probe gated on supportsInterface(0x80ac58cd) to prevent controller spoofing
     */
    function _getController(address addr) private view returns (address) {
        // Try ERC-6551 TBA owner() or Safe owner()
        (bool success, bytes memory data) = addr.staticcall{gas: 30000}(
            abi.encodeWithSignature("owner()")
        );
        if (success && data.length == 32) {
            return abi.decode(data, (address));
        }

        // Try ERC-721 ownerOf (if addr is an NFT)
        // Gated on ERC-165 to prevent controller spoofing via decoy contracts
        (success, data) = addr.staticcall{gas: 20000}(
            abi.encodeWithSignature(
                "supportsInterface(bytes4)",
                ERC721_INTERFACE_ID
            )
        );
        if (success && data.length >= 32 && abi.decode(data, (bool))) {
            (success, data) = addr.staticcall{gas: 30000}(
                abi.encodeWithSignature("ownerOf(uint256)", uint256(0))
            );
            if (success && data.length >= 32) {
                address owner = abi.decode(data, (address));
                if (owner != address(0)) return owner;
            }
        }

        return address(0);
    }

    /**
     * @notice Check if an address is a Gnosis Safe
     * @dev Simplified check via ERC-165 for ISafe interface
     * @dev Gas-stipended to prevent griefing attacks
     */
    function _isSafe(address addr) private view returns (bool) {
        (bool success, bytes memory data) = addr.staticcall{gas: 20000}(
            abi.encodeWithSignature(
                "supportsInterface(bytes4)",
                0xd5506725 // ISafe interface ID (simplified)
            )
        );
        return success && data.length == 32 && abi.decode(data, (bool));
    }

    /**
     * @notice Check if a Safe has at least one enabled IAgentGate module
     * @dev Iterates through enabled modules and checks IAgentGate conformance
     * @dev Gas-stipended to prevent griefing attacks
     * @dev Bounded by MAX_MODULES to prevent DoS via inflated module lists
     */
    function _hasGatingModule(address safeAddr) private view returns (bool) {
        // Get enabled modules from Safe
        (bool success, bytes memory data) = safeAddr.staticcall{gas: 30000}(
            abi.encodeWithSignature("getModules()")
        );
        if (!success || data.length == 0) {
            return false;
        }

        address[] memory modules = abi.decode(data, (address[]));

        uint256 checked = 0;
        for (uint256 i = 0; i < modules.length && checked < MAX_MODULES; i++) {
            if (_isGatingModule(modules[i])) {
                return true;
            }
            unchecked { ++checked; }
        }

        return false;
    }

    /**
     * @notice Check if a module implements IAgentGate and is active with constraints
     * @dev Gas-stipended to prevent griefing attacks
     */
    function _isGatingModule(address module) private view returns (bool) {
        // Check ERC-165 support for IAgentGate
        (bool success, bytes memory data) = module.staticcall{gas: 20000}(
            abi.encodeWithSignature(
                "supportsInterface(bytes4)",
                AGENT_GATE_INTERFACE_ID
            )
        );
        if (!success || data.length != 32 || !abi.decode(data, (bool))) {
            return false;
        }

        // Check isActive()
        (success, data) = module.staticcall{gas: 20000}(
            abi.encodeWithSignature("isActive()")
        );
        if (!success || data.length != 32 || !abi.decode(data, (bool))) {
            return false;
        }

        // Check spendLimit() or executionDelay() > 0
        (success, data) = module.staticcall{gas: 20000}(
            abi.encodeWithSignature("spendLimit()")
        );
        if (success && data.length == 32) {
            uint256 spendLimit = abi.decode(data, (uint256));
            if (spendLimit > 0) return true;
        }

        (success, data) = module.staticcall{gas: 20000}(
            abi.encodeWithSignature("executionDelay()")
        );
        if (success && data.length == 32) {
            uint256 delay = abi.decode(data, (uint256));
            if (delay > 0) return true;
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // IDENTITY RAIL (Optional Provenance Check)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Walk the binding graph for optional namespace provenance
     * @dev This is NOT used for SRE classification. It validates namespace sanity
     * @dev and optionally surfaces "this agent claims to be part of the Org-X fleet"
     * @param start The starting agent name (e.g., "ghostagent.agent.gno")
     * @param registry The GNS registry address for bindingOf queries
     * @return provenance Array of bound parent names (empty if no bindings)
     * @return hasCycle Whether a cycle was detected in the binding graph
     */
    function walkBindingGraph(
        string calldata start,
        address registry
    ) external view returns (string[] memory provenance, bool hasCycle) {
        // This is a placeholder for the binding graph traversal
        // Implementation would call registry.bindingOf() to walk parent bindings
        // This is OPTIONAL and does NOT feed into SRE classification
        revert("Binding graph traversal not yet implemented");
    }
}
