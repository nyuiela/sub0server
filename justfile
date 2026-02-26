# Set the default CRE target environment
TARGET := "staging-settings"

# Default command when typing just `just`
default:
    @just --list


# Install dependencies and setup the WASM toolchain (run from sub0cre; includes cre-setup in markets)
install:
    pnpm install

sim:
    cre workflow simulate markets --target {{TARGET}}

bid-ask-trade-live:
  BID_ASK_TRADE_INTERVAL_MS=30000 BID_ASK_TRADE_ORDER_DELAY_MS=1000 pnpm bid-ask-trade-live -c 