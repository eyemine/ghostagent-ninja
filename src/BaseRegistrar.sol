// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IGNSRegistry } from "./interfaces/IGNSRegistry.sol";
import { IStoryIpaRegistry } from "./interfaces/IStoryIpaRegistry.sol";
import { IERC6551Registry } from "./interfaces/IERC6551Registry.sol";

abstract contract BaseRegistrar is ERC721, Ownable {
    IGNSRegistry public immutable gnsRegistry;
    IStoryIpaRegistry public immutable storyIpaRegistry;
    IERC6551Registry public immutable erc6551Registry;
    address public immutable erc6551AccountImplementation;
    uint256 public immutable chainId;

    uint256 public nextTokenId;
    string private _baseTokenURI;

    mapping(address => bool) public authorisedMinters;

    event SubnameMinted(
        bytes32 indexed parentNode,
        bytes32 indexed labelhash,
        bytes32 indexed subnode,
        uint256 tokenId,
        address owner
    );

    event IpAssetRegistered(bytes32 indexed ipaId, address indexed tokenContract, uint256 indexed tokenId);

    event TokenboundAccountCreated(address indexed account, address indexed tokenContract, uint256 indexed tokenId);

    event MinterAuthorised(address indexed minter, bool authorised);

    modifier onlyMinter() {
        require(authorisedMinters[msg.sender] || msg.sender == owner(), "BaseRegistrar: caller not authorised");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        address _gnsRegistry,
        address _storyIpaRegistry,
        address _erc6551Registry,
        address _erc6551AccountImplementation,
        uint256 _chainId
    ) ERC721(name, symbol) Ownable(msg.sender) {
        gnsRegistry = IGNSRegistry(_gnsRegistry);
        storyIpaRegistry = IStoryIpaRegistry(_storyIpaRegistry);
        erc6551Registry = IERC6551Registry(_erc6551Registry);
        erc6551AccountImplementation = _erc6551AccountImplementation;
        chainId = _chainId;
        nextTokenId = 1;
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function authoriseMinter(address minter, bool authorised) external onlyOwner {
        authorisedMinters[minter] = authorised;
        emit MinterAuthorised(minter, authorised);
    }

    function parentNode() public view virtual returns (bytes32);

    function mintSubname(
        string calldata label,
        address owner,
        bytes calldata storyData,
        bytes32 tbaSalt
    ) external virtual onlyMinter returns (uint256 tokenId, bytes32 subnode, bytes32 ipaId, address tba) {
        tokenId = nextTokenId++;
        _safeMint(owner, tokenId);

        bytes32 lh = keccak256(bytes(label));
        bytes32 pnode = parentNode();

        subnode = gnsRegistry.setSubnodeOwner(pnode, lh, owner);
        emit SubnameMinted(pnode, lh, subnode, tokenId, owner);

        ipaId = storyIpaRegistry.registerIpAsset(address(this), tokenId, storyData);
        emit IpAssetRegistered(ipaId, address(this), tokenId);

        tba = erc6551Registry.createAccount(
            erc6551AccountImplementation,
            tbaSalt,
            chainId,
            address(this),
            tokenId
        );
        emit TokenboundAccountCreated(tba, address(this), tokenId);
    }
}
