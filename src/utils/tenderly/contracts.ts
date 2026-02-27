/**
 * Optional contract addresses on the Tenderly Virtual TestNet (simulate chain).
 * Only needed when the app executes trades on the simulate chain (e.g. agent places orders
 * that hit a contract on the fork). Funding (faucet) does not use these.
 *
 * - TENDERLY_TRADE_EXECUTOR_ADDRESS: Your contract on the virtual chain that executes
 *   trades (e.g. prediction market / vault). The agent or backend would send transactions
 *   to this contract. Leave unset if you only use simulate for funding and read-only flows.
 * - TENDERLY_USDC_SPENDER_ADDRESS: Contract that needs USDC approval (often the same as
 *   trade executor). Used for approve(spender, amount) or allowance checks. Leave unset
 *   if not executing USDC-spending flows on simulate.
 */

import type { TenderlyContractAddresses } from "./types.js";

const optionalEnv = (key: string): string | undefined =>
  process.env[key]?.trim() || undefined;

export function getTenderlyContractAddresses(): TenderlyContractAddresses {
  return {
    tradeExecutor: optionalEnv("TENDERLY_TRADE_EXECUTOR_ADDRESS"),
    usdcSpender: optionalEnv("TENDERLY_USDC_SPENDER_ADDRESS"),
  };
}
