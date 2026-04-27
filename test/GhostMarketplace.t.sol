// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/GhostMarketplace.sol";

/// @dev Minimal mock of GhostRegistry for marketplace tests
contract MockGhostRegistry {
    struct Agent {
        string name;
        address owner;
        address tba;
        address safe;
        address principal;
    }

    mapping(uint256 => Agent) public agents;
    uint256 public nextId;

    function createAgent(
        string memory name,
        address owner_,
        address safe_,
        address principal_
    ) external returns (uint256) {
        uint256 id = nextId++;
        agents[id] = Agent(name, owner_, address(0), safe_, principal_);
        return id;
    }

    function principalOf(uint256 tokenId) external view returns (address) {
        return agents[tokenId].principal;
    }

    function safeOf(uint256 tokenId) external view returns (address) {
        return agents[tokenId].safe;
    }

    function setPrincipal(uint256 tokenId, address newPrincipal) external {
        agents[tokenId].principal = newPrincipal;
    }

    function agentInfo(uint256 tokenId) external view returns (
        string memory name,
        address owner_,
        address tba,
        address safe,
        address principal
    ) {
        Agent storage a = agents[tokenId];
        return (a.name, a.owner, a.tba, a.safe, a.principal);
    }
}

contract GhostMarketplaceTest is Test {
    GhostMarketplace public marketplace;
    MockGhostRegistry public registry;

    address payable treasury = payable(makeAddr("treasury"));
    address alice = makeAddr("alice");   // agent owner / principal
    address bob = makeAddr("bob");       // buyer / hirer
    address carol = makeAddr("carol");   // another user

    address payable aliceSafe;

    uint256 agentId;

    function setUp() public {
        registry = new MockGhostRegistry();
        marketplace = new GhostMarketplace(address(registry), treasury);

        aliceSafe = payable(makeAddr("aliceSafe"));

        // Create an agent owned by alice
        vm.prank(alice);
        agentId = registry.createAgent("ghostagent", alice, aliceSafe, alice);

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    // ── Listing Tests ────────────────────────────────────────────────────────

    function test_listForHire() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether); // 0.001 xDAI/sec

        GhostMarketplace.Listing memory listing = marketplace.getListing(agentId);
        assertTrue(listing.active);
        assertEq(uint256(listing.listingType), uint256(GhostMarketplace.ListingType.Hire));
        assertEq(listing.pricePerSecond, 0.001 ether);
        assertEq(listing.seller, alice);
    }

    function test_listForSale() public {
        vm.prank(alice);
        marketplace.listForSale(agentId, 10 ether);

        GhostMarketplace.Listing memory listing = marketplace.getListing(agentId);
        assertTrue(listing.active);
        assertEq(uint256(listing.listingType), uint256(GhostMarketplace.ListingType.Sale));
        assertEq(listing.salePrice, 10 ether);
    }

    function test_revert_listForHire_notPrincipal() public {
        vm.prank(bob);
        vm.expectRevert("Not agent principal");
        marketplace.listForHire(agentId, 0.001 ether);
    }

    function test_revert_listForSale_notPrincipal() public {
        vm.prank(bob);
        vm.expectRevert("Not agent principal");
        marketplace.listForSale(agentId, 10 ether);
    }

    function test_revert_doubleList() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        vm.prank(alice);
        vm.expectRevert("Already listed");
        marketplace.listForHire(agentId, 0.002 ether);
    }

    function test_delist() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        vm.prank(alice);
        marketplace.delist(agentId);

        GhostMarketplace.Listing memory listing = marketplace.getListing(agentId);
        assertFalse(listing.active);
    }

    function test_revert_delist_notPrincipal() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        vm.prank(bob);
        vm.expectRevert("Not agent principal");
        marketplace.delist(agentId);
    }

    // ── Soulbound Tests ──────────────────────────────────────────────────────

    function test_setSoulbound() public {
        vm.prank(alice);
        marketplace.setSoulbound(agentId);
        assertTrue(marketplace.isSoulbound(agentId));
    }

    function test_revert_soulbound_cannotSell() public {
        vm.prank(alice);
        marketplace.setSoulbound(agentId);

        vm.prank(alice);
        vm.expectRevert("Soulbound agents cannot be sold");
        marketplace.listForSale(agentId, 10 ether);
    }

    function test_soulbound_canStillHire() public {
        vm.prank(alice);
        marketplace.setSoulbound(agentId);

        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        GhostMarketplace.Listing memory listing = marketplace.getListing(agentId);
        assertTrue(listing.active);
        assertTrue(listing.soulbound);
    }

    function test_revert_setSoulbound_notPrincipal() public {
        vm.prank(bob);
        vm.expectRevert("Not agent principal");
        marketplace.setSoulbound(agentId);
    }

    function test_revert_setSoulbound_twice() public {
        vm.prank(alice);
        marketplace.setSoulbound(agentId);

        vm.prank(alice);
        vm.expectRevert("Already soulbound");
        marketplace.setSoulbound(agentId);
    }

    // ── Hire Tests ───────────────────────────────────────────────────────────

    function test_hire() public {
        uint256 rate = 0.001 ether; // per second
        uint256 duration = 3600;    // 1 hour
        uint256 totalCost = rate * duration; // 3.6 ether
        uint256 fee = (totalCost * 1000) / 10000; // 10% = 0.36 ether
        uint256 sellerAmount = totalCost - fee;    // 3.24 ether

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        uint256 treasuryBefore = treasury.balance;
        uint256 safeBefore = aliceSafe.balance;

        vm.prank(bob);
        marketplace.hire{value: totalCost}(agentId, duration);

        // Check fee went to treasury
        assertEq(treasury.balance - treasuryBefore, fee);
        // Check seller payment went to Safe
        assertEq(aliceSafe.balance - safeBefore, sellerAmount);

        // Check hire agreement
        GhostMarketplace.HireAgreement memory agreement = marketplace.getHireAgreement(agentId);
        assertTrue(agreement.active);
        assertEq(agreement.hirer, bob);
        assertEq(agreement.totalPaid, sellerAmount);
        assertEq(agreement.originalPrincipal, alice);

        // Check listing deactivated during hire
        assertFalse(marketplace.getListing(agentId).active);

        // Check isHired
        assertTrue(marketplace.isHired(agentId));
    }

    function test_hire_refundsOverpayment() public {
        uint256 rate = 0.001 ether;
        uint256 duration = 3600;
        uint256 totalCost = rate * duration;
        uint256 overpay = 1 ether;

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        marketplace.hire{value: totalCost + overpay}(agentId, duration);

        // Bob should get the overpayment back
        assertEq(bob.balance, bobBefore - totalCost);
    }

    function test_revert_hire_insufficientPayment() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient payment");
        marketplace.hire{value: 0.1 ether}(agentId, 3600); // needs 3.6 ether
    }

    function test_revert_hire_tooShort() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        vm.prank(bob);
        vm.expectRevert("Duration too short");
        marketplace.hire{value: 1 ether}(agentId, 60); // 60s < 1 hour min
    }

    function test_endHire_afterExpiry() public {
        uint256 rate = 0.001 ether;
        uint256 duration = 3600;

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        vm.prank(bob);
        marketplace.hire{value: rate * duration}(agentId, duration);

        // Warp past end time
        vm.warp(block.timestamp + duration + 1);

        // Anyone can end expired hire
        vm.prank(carol);
        marketplace.endHire(agentId);

        GhostMarketplace.HireAgreement memory agreement = marketplace.getHireAgreement(agentId);
        assertFalse(agreement.active);
        assertTrue(agreement.released);
        assertEq(agreement.originalPrincipal, alice);

        // Listing should be re-activated
        assertTrue(marketplace.getListing(agentId).active);
    }

    function test_endHire_byOriginalPrincipal_early() public {
        uint256 rate = 0.001 ether;
        uint256 duration = 3600;

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        vm.prank(bob);
        marketplace.hire{value: rate * duration}(agentId, duration);

        // Original principal can end early
        vm.prank(alice);
        marketplace.endHire(agentId);

        assertFalse(marketplace.getHireAgreement(agentId).active);
    }

    function test_revert_endHire_notExpired() public {
        uint256 rate = 0.001 ether;
        uint256 duration = 3600;

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        vm.prank(bob);
        marketplace.hire{value: rate * duration}(agentId, duration);

        // Random person can't end before expiry
        vm.prank(carol);
        vm.expectRevert("Hire not expired");
        marketplace.endHire(agentId);
    }

    function test_hireTimeRemaining() public {
        uint256 rate = 0.001 ether;
        uint256 duration = 3600;

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        vm.prank(bob);
        marketplace.hire{value: rate * duration}(agentId, duration);

        assertEq(marketplace.hireTimeRemaining(agentId), duration);

        vm.warp(block.timestamp + 1800); // halfway
        assertEq(marketplace.hireTimeRemaining(agentId), 1800);

        vm.warp(block.timestamp + 1801); // past end
        assertEq(marketplace.hireTimeRemaining(agentId), 0);
    }

    // ── Sale Tests ───────────────────────────────────────────────────────────

    function test_buy() public {
        uint256 price = 10 ether;
        uint256 fee = (price * 1000) / 10000; // 1 ether
        uint256 sellerAmount = price - fee;    // 9 ether

        vm.prank(alice);
        marketplace.listForSale(agentId, price);

        uint256 treasuryBefore = treasury.balance;
        uint256 safeBefore = aliceSafe.balance;

        vm.prank(bob);
        marketplace.buy{value: price}(agentId);

        assertEq(treasury.balance - treasuryBefore, fee);
        assertEq(aliceSafe.balance - safeBefore, sellerAmount);

        // Listing should be deactivated
        assertFalse(marketplace.getListing(agentId).active);
    }

    function test_buy_refundsOverpayment() public {
        uint256 price = 10 ether;
        uint256 overpay = 2 ether;

        vm.prank(alice);
        marketplace.listForSale(agentId, price);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        marketplace.buy{value: price + overpay}(agentId);

        assertEq(bob.balance, bobBefore - price);
    }

    function test_revert_buy_insufficientPayment() public {
        vm.prank(alice);
        marketplace.listForSale(agentId, 10 ether);

        vm.prank(bob);
        vm.expectRevert("Insufficient payment");
        marketplace.buy{value: 5 ether}(agentId);
    }

    function test_revert_buy_hireListingNotSale() public {
        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);

        vm.prank(bob);
        vm.expectRevert("Not listed for sale");
        marketplace.buy{value: 10 ether}(agentId);
    }

    // ── Quote Tests ──────────────────────────────────────────────────────────

    function test_quoteHire() public {
        uint256 rate = 0.001 ether;
        uint256 duration = 3600;

        vm.prank(alice);
        marketplace.listForHire(agentId, rate);

        (uint256 totalCost, uint256 fee, uint256 sellerReceives) = marketplace.quoteHire(agentId, duration);
        assertEq(totalCost, rate * duration);
        assertEq(fee, (totalCost * 1000) / 10000);
        assertEq(sellerReceives, totalCost - fee);
    }

    // ── Fee Math Tests ───────────────────────────────────────────────────────

    function test_feeIsExactly10Percent() public {
        uint256 price = 1 ether;
        uint256 fee = (price * marketplace.FEE_BPS()) / marketplace.BPS_DENOMINATOR();
        assertEq(fee, 0.1 ether);
    }

    function test_feeOnSmallAmount() public {
        // 0.01 xDAI → fee should be 0.001 xDAI
        uint256 price = 0.01 ether;
        uint256 fee = (price * marketplace.FEE_BPS()) / marketplace.BPS_DENOMINATOR();
        assertEq(fee, 0.001 ether);
    }

    // ── Admin Tests ──────────────────────────────────────────────────────────

    function test_setTreasury() public {
        address payable newTreasury = payable(makeAddr("newTreasury"));
        marketplace.setTreasury(newTreasury);
        assertEq(marketplace.treasury(), newTreasury);
    }

    function test_revert_setTreasury_notOwner() public {
        vm.prank(bob);
        vm.expectRevert();
        marketplace.setTreasury(payable(bob));
    }

    function test_listedCount() public {
        assertEq(marketplace.listedCount(), 0);

        vm.prank(alice);
        marketplace.listForHire(agentId, 0.001 ether);
        assertEq(marketplace.listedCount(), 1);
    }
}
