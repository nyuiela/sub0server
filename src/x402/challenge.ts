/**
 * Build 402 Payment Required response body for simulation.
 * Format per x402 / g402: x402Version, accepts (scheme, network, maxAmountRequired, asset, payTo, resource, description, maxTimeoutSeconds).
 */

import { getX402Config } from "./config.js";
import { computeSimulatePriceUsdc, usdcToAtomic } from "./pricing.js";

const X402_VERSION = 2;
const PAYMENT_TIMEOUT_SECONDS = 300;

export interface PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  mimeType?: string;
  outputSchema?: null;
  extra?: Record<string, unknown>;
}

export interface PaymentRequiredBody {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirement[];
}

/** Network string for x402 (base-sepolia or base for mainnet). */
function networkName(chainId: number): string {
  if (chainId === 84532) return "base-sepolia";
  if (chainId === 8453) return "base";
  return `eip155:${chainId}`;
}

export function buildSimulatePaymentRequired(
  resourceUrl: string,
  maxMarkets: number,
  durationMinutes: number
): PaymentRequiredBody | null {
  const config = getX402Config();
  if (!config.enabled || !config.receiverAddress) return null;

  const usdc = computeSimulatePriceUsdc(maxMarkets, durationMinutes);
  const atomic = usdcToAtomic(usdc);

  return {
    x402Version: X402_VERSION,
    error: "Payment required to start simulation",
    accepts: [
      {
        scheme: "exact",
        network: networkName(config.chainId),
        maxAmountRequired: atomic,
        asset: config.usdcAddress,
        payTo: config.receiverAddress,
        resource: resourceUrl,
        description: `Simulation: ${maxMarkets} markets, ${durationMinutes} min`,
        mimeType: "application/json",
        outputSchema: null,
        maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}
