# LMSR Prediction Market: Quote to On-Chain Mint Flow

Sequence from user (or AI agent) requesting a price to on-chain execution and token minting.

```mermaid
sequenceDiagram
    participant User as User / Agent
    participant Backend as Backend (Node)
    participant LMSR as lmsr-engine
    participant Signer as EIP-712 Signer
    participant Contract as PredictionVault.sol
    participant USDC as USDC
    participant ERC1155 as Outcome Tokens

    User->>Backend: Request quote (marketId, outcomeIndex, side, quantity)
    Backend->>Backend: Load market state (q, b)
    Backend->>LMSR: getQuoteForBuy(q, b, outcomeIndex, quantity) or getQuoteForSell(...)
    LMSR->>LMSR: calculateCost, getInstantPrice, getTradeCostFromVector
    LMSR-->>Backend: { instantPrice, tradeCost, qAfter }
    Backend->>Backend: Build LMSRQuote (nonce, deadline)
    Backend->>Signer: signQuote(quote, domain, backendAccount)
    Signer->>Signer: EIP-712 typed data hash + sign
    Signer-->>Backend: signature
    Backend-->>User: Quote + signature (instantPrice, tradeCost, nonce, deadline, sig)

    User->>Contract: executeTrade(marketId, outcomeIndex, buy, quantity, tradeCostUsdc, nonce, deadline, signature)
    Contract->>Contract: Require block.timestamp <= deadline
    Contract->>Contract: Require !nonceUsed[marketIdHash][nonce]
    Contract->>Contract: digest = _hashTypedDataV4(structHash)
    Contract->>Contract: signer = ECDSA.recover(digest, signature)
    Contract->>Contract: Require signer == backendSigner
    Contract->>Contract: nonceUsed[marketIdHash][nonce] = true
    alt buy
        Contract->>User: usdc.transferFrom(user, vault, tradeCostUsdc)
        Contract->>ERC1155: _mint(user, tokenId(outcomeIndex), quantity)
    else sell
        Contract->>ERC1155: _burn(user, tokenId(outcomeIndex), quantity)
        Contract->>User: usdc.transfer(user, tradeCostUsdc)
    end
    Contract-->>User: TradeExecuted event
    ERC1155-->>User: Outcome tokens (or USDC for sell)
```

## Complete Set Mint (1 YES + 1 NO for 1 USDC)

```mermaid
sequenceDiagram
    participant User as User
    participant Contract as PredictionVault.sol
    participant USDC as USDC
    participant ERC1155 as Outcome Tokens

    User->>Contract: completeSetMint(marketId, amount)
    Contract->>Contract: Require numOutcomesByMarket[marketIdHash] >= 2
    Contract->>User: usdc.transferFrom(user, vault, amount * 1e6)
    loop For each outcome 0..numOutcomes-1
        Contract->>ERC1155: _mint(user, tokenId(marketId, i), amount * 1e18, "")
    end
    Contract-->>User: CompleteSetMinted event
    ERC1155-->>User: amount of each outcome token
```

## Component Roles

| Component | Role |
|-----------|------|
| **lmsr-engine.ts** | Pure math: C(q), p_i(q), trade cost, slippage. No I/O. |
| **Backend** | Holds market state (q, b), calls LMSR, builds quote, signs with EIP-712. |
| **PredictionVault.sol** | Verifies signature, escrows USDC, mints/burns ERC1155. No logarithms. |
| **EIP-712** | Same domain and struct (LMSRQuote) in backend and contract so signature is verifiable on-chain. |
