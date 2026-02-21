// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PredictionVault
 * @notice Hybrid LMSR: off-chain quoting (backend signs EIP-712), on-chain execution.
 *         Holds USDC, mints ERC1155 outcome tokens. No logarithms on-chain.
 */
contract PredictionVault is ERC1155, EIP712, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "LMSRQuote(bytes32 marketId,uint256 outcomeIndex,bool buy,uint256 quantity,uint256 tradeCostUsdc,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdc;
    address public backendSigner;
    uint256 public constant USDC_DECIMALS = 6;
    uint256 public constant SHARES_DECIMALS = 18;
    uint256 public constant ONE_USDC = 10 ** USDC_DECIMALS;
    uint256 public constant ONE_SHARE = 10 ** SHARES_DECIMALS;

    mapping(bytes32 => uint8) public numOutcomesByMarket;
    mapping(bytes32 => mapping(uint256 => bool)) public nonceUsed;

    event TradeExecuted(
        bytes32 indexed marketIdHash,
        uint256 outcomeIndex,
        bool buy,
        uint256 quantity,
        uint256 tradeCostUsdc,
        address user
    );
    event CompleteSetMinted(bytes32 indexed marketIdHash, address user, uint256 amount);
    event BackendSignerSet(address oldSigner, address newSigner);
    event MarketInitialized(bytes32 indexed marketIdHash, uint8 numOutcomes);

    error InvalidSignature();
    error ExpiredQuote();
    error NonceAlreadyUsed();
    error MarketNotInitialized();
    error InvalidOutcome();
    error TransferFailed();

    constructor(
        address _usdc,
        address _backendSigner,
        string memory _uri
    ) ERC1155(_uri) EIP712("Sub0PredictionVault", "1") Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        backendSigner = _backendSigner;
    }

    function setBackendSigner(address _backendSigner) external onlyOwner {
        address old = backendSigner;
        backendSigner = _backendSigner;
        emit BackendSignerSet(old, _backendSigner);
    }

    /**
     * @dev Initialize a market (number of outcomes). Must be called before trading.
     */
    function initializeMarket(string calldata marketId, uint8 numOutcomes) external onlyOwner {
        if (numOutcomes < 2) revert InvalidOutcome();
        bytes32 h = keccak256(abi.encode(marketId));
        numOutcomesByMarket[h] = numOutcomes;
        emit MarketInitialized(h, numOutcomes);
    }

    function _tokenId(bytes32 marketIdHash, uint256 outcomeIndex) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(marketIdHash, outcomeIndex)));
    }

    function _hashQuote(
        bytes32 marketIdHash,
        uint256 outcomeIndex,
        bool buy,
        uint256 quantity,
        uint256 tradeCostUsdc,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    marketIdHash,
                    outcomeIndex,
                    buy,
                    quantity,
                    tradeCostUsdc,
                    nonce,
                    deadline
                )
            )
        );
    }

    /**
     * @dev Execute a trade: verify backend signature, pull USDC from user, mint outcome tokens.
     *      Backend computes LMSR off-chain and signs (marketIdHash, outcomeIndex, buy, quantity, tradeCostUsdc, nonce, deadline).
     */
    function executeTrade(
        string calldata marketId,
        uint256 outcomeIndex,
        bool buy,
        uint256 quantity,
        uint256 tradeCostUsdc,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert ExpiredQuote();
        bytes32 marketIdHash = keccak256(abi.encode(marketId));
        if (nonceUsed[marketIdHash][nonce]) revert NonceAlreadyUsed();
        uint8 n = numOutcomesByMarket[marketIdHash];
        if (n == 0) revert MarketNotInitialized();
        if (outcomeIndex >= n) revert InvalidOutcome();

        bytes32 digest = _hashQuote(marketIdHash, outcomeIndex, buy, quantity, tradeCostUsdc, nonce, deadline);
        address signer = ECDSA.recover(digest, signature);
        if (signer != backendSigner) revert InvalidSignature();

        nonceUsed[marketIdHash][nonce] = true;

        if (buy) {
            if (tradeCostUsdc > 0 && !usdc.transferFrom(msg.sender, address(this), tradeCostUsdc)) revert TransferFailed();
            uint256 tid = _tokenId(marketIdHash, outcomeIndex);
            _mint(msg.sender, tid, quantity, "");
        } else {
            uint256 tid = _tokenId(marketIdHash, outcomeIndex);
            _burn(msg.sender, tid, quantity);
            if (tradeCostUsdc > 0 && !usdc.transfer(msg.sender, tradeCostUsdc)) revert TransferFailed();
        }

        emit TradeExecuted(marketIdHash, outcomeIndex, buy, quantity, tradeCostUsdc, msg.sender);
    }

    /**
     * @dev Mint a complete set (e.g. 1 YES + 1 NO) by depositing exactly 1 USDC per set.
     */
    function completeSetMint(string calldata marketId, uint256 amount) external {
        bytes32 marketIdHash = keccak256(abi.encode(marketId));
        uint8 n = numOutcomesByMarket[marketIdHash];
        if (n == 0) revert MarketNotInitialized();
        uint256 cost = amount * ONE_USDC;
        if (!usdc.transferFrom(msg.sender, address(this), cost)) revert TransferFailed();

        uint256 sharesPerOutcome = amount * ONE_SHARE;
        for (uint256 i = 0; i < n; i++) {
            uint256 tid = _tokenId(marketIdHash, i);
            _mint(msg.sender, tid, sharesPerOutcome, "");
        }
        emit CompleteSetMinted(marketIdHash, msg.sender, amount);
    }
}
