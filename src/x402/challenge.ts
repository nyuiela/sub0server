/**
 * Build 402 Payment Required response body for simulation.
 * Format per x402 / g402: x402Version, accepts (scheme, network, maxAmountRequired, asset, payTo, resource, description, maxTimeoutSeconds).
 * Client (x402-fetch) validates accepts with Zod; outputSchema must be an object when present, not null.
 * description = service-level (what the paid endpoint does). outputSchema = what the API returns after payment (helps validators/facilitators).
 * Note: PaymentRequirementsSchema in x402 does not define inputSchema; expected POST body is documented in description.
 */

import { getX402Config } from "./config.js";
import { computeSimulatePriceUsdc, usdcToAtomic } from "./pricing.js";

const X402_VERSION = 2;
const PAYMENT_TIMEOUT_SECONDS = 300;

/** Service-level description for the x402 simulation endpoint (for validators/facilitators and agents). */
const X402_SERVICE_DESCRIPTION =
  "Paid simulation service: start a backtest run for your agent over a date range. " +
  "POST body: agentId (string), dateRange { start, end } (ISO dates), maxMarkets (1–500), durationMinutes. " +
  "Returns enqueued count and job IDs; optional payer address. Price in USDC depends on markets and duration.";

/**
 * JSON Schema for the simulation start API response.
 * Describes the exact response shape so validators/facilitators and discoverers know what to expect.
 */
const SIMULATE_START_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  description: "Response after successful payment and simulation start.",
  properties: {
    enqueued: {
      type: "number",
      description: "Number of markets enqueued for simulation.",
    },
    jobIds: {
      type: "array",
      items: { type: "string" },
      description: "Job IDs for the enqueued prediction tasks.",
    },
    payer: {
      type: "string",
      description: "Address that was used to make the payment (if returned by server).",
    },
  },
  additionalProperties: true,
};

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
  outputSchema?: Record<string, unknown>;
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
        description: X402_SERVICE_DESCRIPTION,
        mimeType: "application/json",
        outputSchema: SIMULATE_START_OUTPUT_SCHEMA,
        maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
        extra: {
          name: "USDC",
          version: "2",
          runParams: { maxMarkets, durationMinutes },
        },
      },
    ],
  };
}
