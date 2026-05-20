// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @title NFTmailBeacon
/// @notice Tier beacon NFT deployed on Base.
///   Odd tokenId  = Pro     ($10 USDC)
///   Even tokenId = Premium ($24 USDC)
///
/// Minted to user's Farcaster custody address (or any Base wallet).
/// Serves as the on-chain tier credential for nftmail.box and ghostagent.ninja Snap.
/// One contract — two clients (Farcaster mini, MetaMask Snap).
contract NFTmailBeacon is ERC721, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @dev Odd sequence: 1, 3, 5, ... (Pro)
    uint256 public nextProId = 1;
    /// @dev Even sequence: 2, 4, 6, ... (Premium)
    uint256 public nextPremiumId = 2;

    event ProMinted(address indexed to, uint256 indexed tokenId);
    event PremiumMinted(address indexed to, uint256 indexed tokenId);

    constructor(address admin, address minter) ERC721("NFTmail Tier", "NMT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
    }

    // ── Minting ──────────────────────────────────────────────────────────────

    function mintPro(address to) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = nextProId;
        nextProId += 2;
        _mint(to, tokenId);
        emit ProMinted(to, tokenId);
    }

    function mintPremium(address to) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        tokenId = nextPremiumId;
        nextPremiumId += 2;
        _mint(to, tokenId);
        emit PremiumMinted(to, tokenId);
    }

    // ── Tier helpers ─────────────────────────────────────────────────────────

    /// @notice Returns true if tokenId is a Premium beacon (even), false if Pro (odd)
    function isPremium(uint256 tokenId) public pure returns (bool) {
        return tokenId % 2 == 0;
    }

    /// @notice Returns "premium" or "pro"
    function tierOf(uint256 tokenId) public pure returns (string memory) {
        return isPremium(tokenId) ? "premium" : "pro";
    }

    // ── Metadata (fully on-chain SVG, no IPFS dependency) ───────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        bool premium = isPremium(tokenId);
        string memory tier        = premium ? "Premium" : "Pro";
        string memory tierUpper   = premium ? "PREMIUM" : "PRO";
        string memory color       = premium ? "#7C3AED" : "#D97706";
        string memory bgAccent    = premium ? "#1a0a2e" : "#1a1200";

        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
            '<rect fill="#0a0a0a" width="512" height="512"/>',
            '<rect fill="', bgAccent, '" x="32" y="32" width="448" height="448" rx="24"/>',
            '<text x="256" y="140" text-anchor="middle" fill="#ffffff" ',
                'font-family="monospace" font-size="28" font-weight="bold">NFTmail</text>',
            '<text x="256" y="260" text-anchor="middle" fill="', color, '" ',
                'font-family="monospace" font-size="72" font-weight="bold">', tierUpper, '</text>',
            '<text x="256" y="330" text-anchor="middle" fill="#888888" ',
                'font-family="monospace" font-size="16">.cast@nftmail.box</text>',
            '<text x="256" y="380" text-anchor="middle" fill="#666666" ',
                'font-family="monospace" font-size="14">nftmail.box</text>',
            '<text x="256" y="430" text-anchor="middle" fill="#444444" ',
                'font-family="monospace" font-size="12">#', tokenId.toString(), '</text>',
            '</svg>'
        ));

        string memory json = string(abi.encodePacked(
            '{"name":"NFTmail ', tier, ' #', tokenId.toString(), '",',
            '"description":"Tier beacon for nftmail.box Farcaster mini-app. ',
                'Odd tokenId = Pro ($10), Even tokenId = Premium ($24).",
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[',
                '{"trait_type":"Tier","value":"', tier, '"},',
                '{"trait_type":"Service","value":"nftmail.box"},',
                '{"trait_type":"Domain","value":".cast@nftmail.box"},',
                '{"trait_type":"Chain","value":"Base"},',
                '{"trait_type":"TokenId Parity","value":"', premium ? "Even" : "Odd", '"}',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // ── ERC165 ───────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
