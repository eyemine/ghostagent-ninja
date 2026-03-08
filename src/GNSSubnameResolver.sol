// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GNSSubnameResolver
 * @notice Wildcard ENS-compatible resolver for *.nftmail.gno, *.molt.gno, etc.
 *
 * When SpaceID/Gnosis grants setResolver() permission on each SLD node in their
 * SidRegistry (0x5dc881dda4e4a8d312be3544ad13118d1a04cb17), point each SLD node
 * to this contract. All subname lookups (rgbanksy.nftmail.gno etc.) will then
 * resolve to the owner recorded in our GNSRegistry.
 *
 * Implements:
 *   - ERC-137 addr(bytes32)          → address of subname owner
 *   - ERC-2304 addr(bytes32,uint256) → multi-chain address (returns ETH addr for coinType 60)
 *   - ERC-634  text(bytes32,string)  → text records stored here
 *   - ERC-181  name(bytes32)         → reverse records (set by owner)
 *   - supportsInterface              → ERC-165
 *
 * Wildcard (ERC-3668 CCIP-Read) is NOT required because we hold all subname data
 * on-chain in GNSRegistry and this contract. Resolution is fully on-chain.
 */
contract GNSSubnameResolver is Ownable {

    // ─── State ───────────────────────────────────────────────────────────────

    /// Our GNSRegistry — subnode → owner mapping written at mint time
    IGNSRegistry public immutable gnsRegistry;

    /// Text records: node → key → value
    mapping(bytes32 => mapping(string => string)) private _text;

    /// Reverse records: node → name
    mapping(bytes32 => string) private _name;

    /// Additional addr overrides: node → coinType → address bytes
    mapping(bytes32 => mapping(uint256 => bytes)) private _addrs;

    // ─── Events ──────────────────────────────────────────────────────────────

    event AddrChanged(bytes32 indexed node, address addr);
    event AddressChanged(bytes32 indexed node, uint256 coinType, bytes newAddress);
    event TextChanged(bytes32 indexed node, string indexed key, string value);
    event NameChanged(bytes32 indexed node, string name);

    // ─── ERC-165 interface IDs ────────────────────────────────────────────────

    bytes4 private constant IFACE_ADDR         = 0x3b3b57de; // addr(bytes32)
    bytes4 private constant IFACE_ADDR_MULTI   = 0xf1cb7e06; // addr(bytes32,uint256)
    bytes4 private constant IFACE_TEXT         = 0x59d1d43c; // text(bytes32,string)
    bytes4 private constant IFACE_NAME         = 0x691f3431; // name(bytes32)
    bytes4 private constant IFACE_ERC165       = 0x01ffc9a7;

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _gnsRegistry) Ownable(msg.sender) {
        gnsRegistry = IGNSRegistry(_gnsRegistry);
    }

    // ─── ERC-137: addr ────────────────────────────────────────────────────────

    /**
     * @notice Resolve a subname node to its Ethereum address.
     * First checks explicit addr override, then falls back to GNSRegistry owner.
     */
    function addr(bytes32 node) public view returns (address) {
        bytes memory raw = _addrs[node][60];
        if (raw.length == 20) {
            address a;
            assembly { a := mload(add(raw, 20)) }
            return a;
        }
        return gnsRegistry.nodeOwner(node);
    }

    // ─── ERC-2304: addr(bytes32,uint256) ─────────────────────────────────────

    function addr(bytes32 node, uint256 coinType) public view returns (bytes memory) {
        bytes memory raw = _addrs[node][coinType];
        if (raw.length > 0) return raw;
        if (coinType == 60) {
            address owner = gnsRegistry.nodeOwner(node);
            if (owner != address(0)) {
                return abi.encodePacked(owner);
            }
        }
        return "";
    }

    // ─── ERC-634: text ────────────────────────────────────────────────────────

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _text[node][key];
    }

    // ─── ERC-181: name (reverse) ─────────────────────────────────────────────

    function name(bytes32 node) external view returns (string memory) {
        return _name[node];
    }

    // ─── Setters (callable by node owner only) ────────────────────────────────

    modifier onlyNodeOwner(bytes32 node) {
        require(
            msg.sender == gnsRegistry.nodeOwner(node) || msg.sender == owner(),
            "GNSSubnameResolver: not node owner"
        );
        _;
    }

    function setAddr(bytes32 node, address _addr) external onlyNodeOwner(node) {
        _addrs[node][60] = abi.encodePacked(_addr);
        emit AddrChanged(node, _addr);
        emit AddressChanged(node, 60, abi.encodePacked(_addr));
    }

    function setAddr(bytes32 node, uint256 coinType, bytes calldata newAddress)
        external onlyNodeOwner(node)
    {
        _addrs[node][coinType] = newAddress;
        emit AddressChanged(node, coinType, newAddress);
    }

    function setText(bytes32 node, string calldata key, string calldata value)
        external onlyNodeOwner(node)
    {
        _text[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function setName(bytes32 node, string calldata _n) external onlyNodeOwner(node) {
        _name[node] = _n;
        emit NameChanged(node, _n);
    }

    // ─── Bulk text setter (owner only, for seeding agent metadata) ────────────

    function bulkSetText(
        bytes32[] calldata nodes,
        string[] calldata keys,
        string[] calldata values
    ) external onlyOwner {
        require(nodes.length == keys.length && keys.length == values.length, "length mismatch");
        for (uint256 i = 0; i < nodes.length; i++) {
            _text[nodes[i]][keys[i]] = values[i];
            emit TextChanged(nodes[i], keys[i], values[i]);
        }
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == IFACE_ERC165     ||
            interfaceId == IFACE_ADDR       ||
            interfaceId == IFACE_ADDR_MULTI ||
            interfaceId == IFACE_TEXT       ||
            interfaceId == IFACE_NAME;
    }
}

// ─── Minimal interface for our GNSRegistry ───────────────────────────────────

interface IGNSRegistry {
    function nodeOwner(bytes32 node) external view returns (address);
}
