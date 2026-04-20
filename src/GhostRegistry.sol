// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC6551Registry } from "./interfaces/IERC6551Registry.sol";
import { IGnosisSafe } from "./interfaces/IGnosisSafe.sol";

/// @title GhostRegistry
/// @notice Registry for .gno/.ip subnames that automatically:
///   1. Mints NFT to user's EOA/AA account
///   2. Creates TBA (tokenbound account) for the NFT
///   3. Sets TBA as sole owner of user's Safe
///
/// @dev Non-custodial guarantee: only NFT owner can molt() to swap Safe signers
/// @dev ERC-8226 forward-compat: principalOf tracks the human responsible for each agent
contract GhostRegistry is ERC721, Ownable {
    IERC6551Registry public immutable erc6551Registry;
    address public erc6551Implementation;
    uint256 public immutable chainId;

    address private constant _SAFE_SENTINEL_OWNERS = address(0x1);

    uint256 public nextTokenId;
    
    // NFT metadata
    mapping(uint256 => string) public names;        // tokenId → "alice"
    mapping(string => uint256) public nameToId;     // "alice" → tokenId
    
    // TBA tracking
    mapping(uint256 => address) public accountOf;   // tokenId → TBA address
    mapping(uint256 => address) public safeOf;      // tokenId → Safe address

    // ERC-8226 forward-compat: beneficial owner / human responsible for agent actions
    mapping(uint256 => address) public principalOf; // tokenId → principal address

    event Registered(
        uint256 indexed tokenId,
        string name,
        address indexed owner,
        address indexed tba,
        address safe
    );

    event Molted(
        uint256 indexed tokenId,
        address indexed oldTba,
        address indexed newTba,
        address safe
    );

    event PrincipalSet(
        uint256 indexed agentId,
        address indexed principal
    );

    function _execFromModule(
        address safe,
        address to,
        bytes memory data
    ) private returns (bool) {
        try IGnosisSafe(safe).execTransactionFromModule(
            to,
            0,
            data,
            IGnosisSafe.Operation.Call
        ) returns (bool success) {
            return success;
        } catch {
            return false;
        }
    }

    function _trySwapOwner(address safe, address prevOwner, address oldOwner, address newOwner)
        private
        returns (bool)
    {
        bytes memory swapOwnerData = abi.encodeWithSelector(
            IGnosisSafe.swapOwner.selector,
            prevOwner,
            oldOwner,
            newOwner
        );
        return _execFromModule(safe, safe, swapOwnerData);
    }

    constructor(
        address erc6551Registry_,
        address erc6551Implementation_,
        uint256 chainId_
    ) ERC721("GhostAgent", "GA") Ownable(msg.sender) {
        erc6551Registry = IERC6551Registry(erc6551Registry_);
        erc6551Implementation = erc6551Implementation_;
        chainId = chainId_;
    }

    function updateImplementation(address newImpl) external onlyOwner {
        require(newImpl != address(0), "Invalid implementation");
        erc6551Implementation = newImpl;
    }

    /// @notice Register a new .gno/.ip subname, creating:
    ///   1. NFT (minted to msg.sender)
    ///   2. TBA (tokenbound account for the NFT)
    ///   3. Safe (owned by the TBA)
    /// @param name The subname to register (e.g. "alice")
    /// @param safe The Safe address that will be owned by the TBA
    function register(string memory name, address safe) external {
        require(bytes(name).length > 0, "Empty name");
        require(nameToId[name] == 0, "Name taken");
        require(safe != address(0), "Invalid Safe");

        // 1. Mint NFT to caller (EOA or AA account)
        uint256 tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
        names[tokenId] = name;
        nameToId[name] = tokenId;

        // ERC-8226: set principal to msg.sender (the human who registered)
        principalOf[tokenId] = msg.sender;
        emit PrincipalSet(tokenId, msg.sender);

        // 2. Create TBA for the NFT
        address tba = erc6551Registry.createAccount(
            erc6551Implementation,
            bytes32(0),
            chainId,
            address(this),
            tokenId
        );
        accountOf[tokenId] = tba;
        safeOf[tokenId] = safe;

        // 3. Set TBA as sole owner of Safe
        address[] memory owners = IGnosisSafe(safe).getOwners();
        require(owners.length > 0, "Safe has no owners");

        bool swapped;
        if (owners.length == 1) {
            swapped = _trySwapOwner(safe, _SAFE_SENTINEL_OWNERS, owners[0], tba);
        } else {
            // Safe owner linked-list ordering isn't guaranteed to match getOwners() ordering.
            // Try the reasonable combinations for a 2-owner Safe.
            swapped =
                _trySwapOwner(safe, _SAFE_SENTINEL_OWNERS, owners[0], tba) ||
                _trySwapOwner(safe, _SAFE_SENTINEL_OWNERS, owners[1], tba) ||
                _trySwapOwner(safe, owners[0], owners[1], tba) ||
                _trySwapOwner(safe, owners[1], owners[0], tba);
        }

        require(swapped, "Safe owner swap failed");

        emit Registered(tokenId, name, msg.sender, tba, safe);
    }

    /// @notice Molt: swap Safe signers by creating a new TBA
    /// @dev Only callable by NFT owner (non-custodial guarantee)
    /// @dev Principal is intentionally NOT changed — molting preserves responsibility
    function molt(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        
        address safe = safeOf[tokenId];
        address oldTba = accountOf[tokenId];
        
        // Create new TBA for the NFT
        address newTba = erc6551Registry.createAccount(
            erc6551Implementation,
            bytes32(block.timestamp),  // use timestamp as salt for uniqueness
            chainId,
            address(this),
            tokenId
        );
        accountOf[tokenId] = newTba;

        address[] memory owners = IGnosisSafe(safe).getOwners();
        require(owners.length > 0, "Safe has no owners");

        // After register(), Safe should have a single owner (the TBA). Use that as oldOwner.
        bool swapped = _trySwapOwner(safe, _SAFE_SENTINEL_OWNERS, owners[0], newTba);
        require(swapped, "Safe owner swap failed");

        emit Molted(tokenId, oldTba, newTba, safe);
    }

    /// @notice Transfer principal responsibility to a new address
    /// @dev Only callable by the current principal
    function setPrincipal(uint256 tokenId, address newPrincipal) external {
        require(newPrincipal != address(0), "Invalid principal");
        require(principalOf[tokenId] == msg.sender, "Not principal");
        principalOf[tokenId] = newPrincipal;
        emit PrincipalSet(tokenId, newPrincipal);
    }

    /// @notice Get full agent info by tokenId
    function agentInfo(uint256 tokenId) external view returns (
        string memory name,
        address owner,
        address tba,
        address safe,
        address principal
    ) {
        require(ownerOf(tokenId) != address(0), "Token doesn't exist");
        return (
            names[tokenId],
            ownerOf(tokenId),
            accountOf[tokenId],
            safeOf[tokenId],
            principalOf[tokenId]
        );
    }

    /// @notice Get full agent info by name
    function agentInfoByName(string memory name) external view returns (
        uint256 tokenId,
        address owner,
        address tba,
        address safe,
        address principal
    ) {
        tokenId = nameToId[name];
        require(ownerOf(tokenId) != address(0), "Name not registered");
        return (
            tokenId,
            ownerOf(tokenId),
            accountOf[tokenId],
            safeOf[tokenId],
            principalOf[tokenId]
        );
    }
}
