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
            '<text x="256" y="120" text-anchor="middle" fill="#ffffff" ',
                'font-family="monospace" font-size="28" font-weight="bold">NFTmail</text>',
            '<text x="256" y="220" text-anchor="middle" fill="', color, '" ',
                'font-family="monospace" font-size="72" font-weight="bold">', tierUpper, '</text>',
            '<g transform="translate(206, 260) scale(4)">',
            '<path fill="#cccccc" d="M20.7037,6.05234 H12.5016 V8.69818 H19.7997 V10.3408 H12.5016 V13.11893 H20.2296 L20.2737,14.77257 H12.5016 V20.63751 H10.79283 V6.05234 Q9.88883,8.64305 7.33119,11.09045 L5.77676,10.2526 Q9.66835,5.31371 10.49517,0 H12.19292 Q11.96141,1.57648 11.12356,3.79237 H20.7037 Z M7.30917,1.0473 Q7.05562,1.91822 6.36108,3.72621 L5.66655,5.46805 V20.63751 H3.94676 V8.42257 Q2.91047,10.32978 1.57653,11.76294 L0.00005,10.85894 Q3.79242,6.72482 5.77679,0.30762 Z"/>',
            '</g>',
            '<text x="256" y="380" text-anchor="middle" fill="#888888" ',
                'font-family="monospace" font-size="16">.cast@nftmail.box</text>',
            '<text x="256" y="430" text-anchor="middle" fill="#444444" ',
                'font-family="monospace" font-size="12">#', tokenId.toString(), '</text>',
            '</svg>'
        ));

        string memory json = string(abi.encodePacked(
            '{"name":"NFTmail ', tier, ' #', tokenId.toString(), '",',
            '"description":"Tier beacon for nftmail.box Farcaster mini-app. ',
                'Odd tokenId = Pro, Even tokenId = Premium.",',
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
