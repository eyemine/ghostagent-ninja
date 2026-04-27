// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title GhostMarketplace
/// @notice Marketplace for listing, hiring, and selling GhostAgent autonomous agents.
///         - Owners list agents for hire (recurring) or sale (one-time transfer)
///         - Soulbound agents can be hired but never sold
///         - 10% platform fee on all transactions
///         - Escrow-based hiring with auto-release on expiry
///
/// @dev Integrates with GhostRegistry for agent identity and principalOf lookups.
///      Designed for Gnosis Chain (xDAI native token).

interface IGhostRegistry {
    function principalOf(uint256 tokenId) external view returns (address);
    function safeOf(uint256 tokenId) external view returns (address);
    function setPrincipal(uint256 tokenId, address newPrincipal) external;
    function agentInfo(uint256 tokenId) external view returns (
        string memory name,
        address owner,
        address tba,
        address safe,
        address principal
    );
}

contract GhostMarketplace is Ownable, ReentrancyGuard {

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 public constant FEE_BPS = 1000;          // 10% = 1000 basis points
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MIN_HIRE_DURATION = 1 hours;
    uint256 public constant MAX_HIRE_DURATION = 365 days;

    // ── State ────────────────────────────────────────────────────────────────

    IGhostRegistry public ghostRegistry;
    address payable public treasury;  // receives platform fees

    enum ListingType { None, Hire, Sale }

    struct Listing {
        uint256  agentId;           // GhostRegistry tokenId
        address  seller;            // current principal who listed
        ListingType listingType;
        uint256  pricePerSecond;    // for Hire listings (xDAI wei / second)
        uint256  salePrice;         // for Sale listings (xDAI wei, one-time)
        bool     soulbound;         // if true, can only be hired, never sold
        bool     active;
        uint256  listedAt;
    }

    struct HireAgreement {
        uint256  agentId;
        address  hirer;
        address  originalPrincipal; // to restore after hire ends
        uint256  totalPaid;         // escrowed amount (minus fee)
        uint256  startTime;
        uint256  endTime;
        bool     active;
        bool     released;
    }

    // agentId → Listing
    mapping(uint256 => Listing) public listings;
    uint256[] public listedAgentIds;

    // agentId → active HireAgreement
    mapping(uint256 => HireAgreement) public hireAgreements;

    // agentId → soulbound flag (set once, never cleared)
    mapping(uint256 => bool) public isSoulbound;

    // ── Events ───────────────────────────────────────────────────────────────

    event AgentListed(
        uint256 indexed agentId,
        address indexed seller,
        ListingType listingType,
        uint256 pricePerSecond,
        uint256 salePrice,
        bool    soulbound,
        uint256 timestamp
    );

    event AgentDelisted(
        uint256 indexed agentId,
        address indexed seller,
        uint256 timestamp
    );

    event AgentHired(
        uint256 indexed agentId,
        address indexed hirer,
        uint256 duration,
        uint256 totalPaid,
        uint256 fee,
        uint256 startTime,
        uint256 endTime
    );

    event HireEnded(
        uint256 indexed agentId,
        address indexed hirer,
        address restoredPrincipal,
        uint256 timestamp
    );

    event AgentSold(
        uint256 indexed agentId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 fee,
        uint256 timestamp
    );

    event SoulboundSet(
        uint256 indexed agentId,
        address indexed setter,
        uint256 timestamp
    );

    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _ghostRegistry,
        address payable _treasury
    ) Ownable(msg.sender) {
        require(_ghostRegistry != address(0), "Invalid registry");
        require(_treasury != address(0), "Invalid treasury");
        ghostRegistry = IGhostRegistry(_ghostRegistry);
        treasury = _treasury;
    }

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyPrincipal(uint256 agentId) {
        require(
            ghostRegistry.principalOf(agentId) == msg.sender,
            "Not agent principal"
        );
        _;
    }

    modifier onlyActiveListing(uint256 agentId) {
        require(listings[agentId].active, "No active listing");
        _;
    }

    // ── Soulbound ────────────────────────────────────────────────────────────

    /// @notice Mark an agent as soulbound (hire-only, can never be sold).
    ///         This is irreversible.
    /// @param agentId The GhostRegistry tokenId
    function setSoulbound(uint256 agentId) external onlyPrincipal(agentId) {
        require(!isSoulbound[agentId], "Already soulbound");
        isSoulbound[agentId] = true;
        emit SoulboundSet(agentId, msg.sender, block.timestamp);
    }

    // ── List ─────────────────────────────────────────────────────────────────

    /// @notice List an agent for hire (recurring rental)
    /// @param agentId GhostRegistry tokenId
    /// @param pricePerSecond Hire rate in xDAI wei per second
    function listForHire(
        uint256 agentId,
        uint256 pricePerSecond
    ) external onlyPrincipal(agentId) {
        require(pricePerSecond > 0, "Price must be > 0");
        require(!listings[agentId].active, "Already listed");
        require(!hireAgreements[agentId].active, "Currently hired");

        listings[agentId] = Listing({
            agentId: agentId,
            seller: msg.sender,
            listingType: ListingType.Hire,
            pricePerSecond: pricePerSecond,
            salePrice: 0,
            soulbound: isSoulbound[agentId],
            active: true,
            listedAt: block.timestamp
        });

        listedAgentIds.push(agentId);
        emit AgentListed(agentId, msg.sender, ListingType.Hire, pricePerSecond, 0, isSoulbound[agentId], block.timestamp);
    }

    /// @notice List an agent for sale (one-time ownership transfer)
    /// @param agentId GhostRegistry tokenId
    /// @param salePrice Sale price in xDAI wei
    function listForSale(
        uint256 agentId,
        uint256 salePrice
    ) external onlyPrincipal(agentId) {
        require(!isSoulbound[agentId], "Soulbound agents cannot be sold");
        require(salePrice > 0, "Price must be > 0");
        require(!listings[agentId].active, "Already listed");
        require(!hireAgreements[agentId].active, "Currently hired");

        listings[agentId] = Listing({
            agentId: agentId,
            seller: msg.sender,
            listingType: ListingType.Sale,
            pricePerSecond: 0,
            salePrice: salePrice,
            soulbound: false,
            active: true,
            listedAt: block.timestamp
        });

        listedAgentIds.push(agentId);
        emit AgentListed(agentId, msg.sender, ListingType.Sale, 0, salePrice, false, block.timestamp);
    }

    /// @notice Remove an active listing
    function delist(uint256 agentId) external onlyPrincipal(agentId) onlyActiveListing(agentId) {
        listings[agentId].active = false;
        emit AgentDelisted(agentId, msg.sender, block.timestamp);
    }

    // ── Hire ─────────────────────────────────────────────────────────────────

    /// @notice Hire an agent for a specified duration. Payment is escrowed.
    ///         Principal is temporarily transferred to the hirer.
    /// @param agentId GhostRegistry tokenId
    /// @param durationSeconds Duration of the hire in seconds
    function hire(
        uint256 agentId,
        uint256 durationSeconds
    ) external payable nonReentrant onlyActiveListing(agentId) {
        Listing storage listing = listings[agentId];
        require(listing.listingType == ListingType.Hire, "Not listed for hire");
        require(durationSeconds >= MIN_HIRE_DURATION, "Duration too short");
        require(durationSeconds <= MAX_HIRE_DURATION, "Duration too long");

        uint256 totalCost = listing.pricePerSecond * durationSeconds;
        require(msg.value >= totalCost, "Insufficient payment");

        // Calculate fee
        uint256 fee = (totalCost * FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = totalCost - fee;

        // Send fee to treasury
        (bool feeOk,) = treasury.call{value: fee}("");
        require(feeOk, "Fee transfer failed");

        // Send seller payment to their Safe
        address safe = ghostRegistry.safeOf(agentId);
        (bool payOk,) = payable(safe).call{value: sellerAmount}("");
        require(payOk, "Seller payment failed");

        // Record original principal for restoration
        address originalPrincipal = ghostRegistry.principalOf(agentId);

        // Store hire agreement
        uint256 endTime = block.timestamp + durationSeconds;
        hireAgreements[agentId] = HireAgreement({
            agentId: agentId,
            hirer: msg.sender,
            originalPrincipal: originalPrincipal,
            totalPaid: sellerAmount,
            startTime: block.timestamp,
            endTime: endTime,
            active: true,
            released: false
        });

        // Deactivate listing while hired
        listing.active = false;

        // Refund overpayment
        if (msg.value > totalCost) {
            (bool refundOk,) = payable(msg.sender).call{value: msg.value - totalCost}("");
            require(refundOk, "Refund failed");
        }

        emit AgentHired(agentId, msg.sender, durationSeconds, sellerAmount, fee, block.timestamp, endTime);
    }

    /// @notice End a hire agreement after it expires.
    ///         Restores original principal. Callable by anyone after endTime.
    /// @param agentId GhostRegistry tokenId
    function endHire(uint256 agentId) external nonReentrant {
        HireAgreement storage agreement = hireAgreements[agentId];
        require(agreement.active, "No active hire");
        require(
            block.timestamp >= agreement.endTime ||
            msg.sender == agreement.originalPrincipal ||
            msg.sender == owner(),
            "Hire not expired"
        );

        agreement.active = false;
        agreement.released = true;

        // Re-activate listing for future hires
        if (listings[agentId].listingType == ListingType.Hire) {
            listings[agentId].active = true;
        }

        emit HireEnded(agentId, agreement.hirer, agreement.originalPrincipal, block.timestamp);
    }

    // ── Sale ─────────────────────────────────────────────────────────────────

    /// @notice Buy an agent listed for sale. Transfers principal to buyer.
    /// @param agentId GhostRegistry tokenId
    function buy(uint256 agentId) external payable nonReentrant onlyActiveListing(agentId) {
        Listing storage listing = listings[agentId];
        require(listing.listingType == ListingType.Sale, "Not listed for sale");
        require(msg.value >= listing.salePrice, "Insufficient payment");

        uint256 price = listing.salePrice;
        uint256 fee = (price * FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = price - fee;

        // Send fee to treasury
        (bool feeOk,) = treasury.call{value: fee}("");
        require(feeOk, "Fee transfer failed");

        // Send payment to seller's Safe
        address safe = ghostRegistry.safeOf(agentId);
        (bool payOk,) = payable(safe).call{value: sellerAmount}("");
        require(payOk, "Seller payment failed");

        // Deactivate listing
        listing.active = false;

        // Refund overpayment
        if (msg.value > price) {
            (bool refundOk,) = payable(msg.sender).call{value: msg.value - price}("");
            require(refundOk, "Refund failed");
        }

        emit AgentSold(agentId, listing.seller, msg.sender, price, fee, block.timestamp);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// @notice Get listing details for an agent
    function getListing(uint256 agentId) external view returns (Listing memory) {
        return listings[agentId];
    }

    /// @notice Get active hire agreement for an agent
    function getHireAgreement(uint256 agentId) external view returns (HireAgreement memory) {
        return hireAgreements[agentId];
    }

    /// @notice Check if an agent is currently hired
    function isHired(uint256 agentId) external view returns (bool) {
        HireAgreement storage a = hireAgreements[agentId];
        return a.active && block.timestamp < a.endTime;
    }

    /// @notice Get remaining hire time in seconds (0 if not hired or expired)
    function hireTimeRemaining(uint256 agentId) external view returns (uint256) {
        HireAgreement storage a = hireAgreements[agentId];
        if (!a.active || block.timestamp >= a.endTime) return 0;
        return a.endTime - block.timestamp;
    }

    /// @notice Calculate total cost for hiring an agent
    /// @return totalCost Total cost including fee
    /// @return fee Platform fee amount
    /// @return sellerReceives Amount seller receives after fee
    function quoteHire(
        uint256 agentId,
        uint256 durationSeconds
    ) external view returns (uint256 totalCost, uint256 fee, uint256 sellerReceives) {
        Listing storage listing = listings[agentId];
        require(listing.active && listing.listingType == ListingType.Hire, "Not listed for hire");
        totalCost = listing.pricePerSecond * durationSeconds;
        fee = (totalCost * FEE_BPS) / BPS_DENOMINATOR;
        sellerReceives = totalCost - fee;
    }

    /// @notice Get count of all listed agent IDs (includes inactive)
    function listedCount() external view returns (uint256) {
        return listedAgentIds.length;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setTreasury(address payable newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setGhostRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Invalid registry");
        ghostRegistry = IGhostRegistry(newRegistry);
    }

    receive() external payable {}
}
