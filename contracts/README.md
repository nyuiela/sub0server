# PredictionVault (LMSR Settlement)

Solidity ^0.8.20, Foundry, OpenZeppelin.

## Setup

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
forge build
```

## Deploy

Deploy with USDC address, backend signer address, and ERC1155 base URI. Then call `initializeMarket(marketId, numOutcomes)` for each market.

## EIP-712

Domain: `Sub0PredictionVault`, version `1`. Struct `LMSRQuote(bytes32 marketId, uint256 outcomeIndex, bool buy, uint256 quantity, uint256 tradeCostUsdc, uint256 nonce, uint256 deadline)`. Backend signs with the same domain and struct; contract verifies via `ECDSA.recover`.
