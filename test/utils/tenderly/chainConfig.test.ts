/**
 * Tests for Tenderly chain config. Uses vi.stubEnv; no real RPC.
 */

import { describe, it, expect, vi } from "vitest";
import { getTenderlyChainConfig } from "../../../src/utils/tenderly/chainConfig.js";

describe("tenderly chainConfig", () => {
  describe("getTenderlyChainConfig", () => {
    it("returns null when TENDERLY_VIRTUAL_TESTNET_RPC is missing", () => {
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_RPC", "");
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC", "https://admin.rpc.example");
      expect(getTenderlyChainConfig()).toBeNull();
    });

    it("returns null when TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC is missing", () => {
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_RPC", "https://rpc.example");
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC", "");
      expect(getTenderlyChainConfig()).toBeNull();
    });

    it("returns chain config when both RPC URLs are set", () => {
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_RPC", "https://virtual.rpc.example");
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC", "https://virtual.admin.rpc.example");
      const config = getTenderlyChainConfig();
      expect(config).not.toBeNull();
      expect(config?.chainId).toBeDefined();
      expect(config?.name).toBeDefined();
      expect(config?.rpcUrl).toBe("https://virtual.rpc.example");
      expect(config?.adminRpcUrl).toBe("https://virtual.admin.rpc.example");
      expect(config?.usdcAddress).toBeDefined();
      expect(config?.nativeCurrency).toBeDefined();
      expect(config?.nativeCurrency.symbol).toBeDefined();
    });

    it("uses TENDERLY_CHAIN_ID when set", () => {
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_RPC", "https://rpc.example");
      vi.stubEnv("TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC", "https://admin.rpc.example");
      vi.stubEnv("TENDERLY_CHAIN_ID", "12345");
      const config = getTenderlyChainConfig();
      expect(config?.chainId).toBe(12345);
    });
  });
});
