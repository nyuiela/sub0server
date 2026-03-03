import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireUser } from "../lib/auth.js";
import { getAllUserBalances, getUserBalance } from "../services/user-balance.service.js";

export async function registerUserBalanceRoutes(app: FastifyInstance): Promise<void> {
  // Get all user balances
  app.get("/api/user/balances", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    try {
      const balances = await getAllUserBalances(user.userId);
      return reply.send({
        data: balances,
        total: balances.length,
      });
    } catch (error) {
      console.error("Failed to get user balances:", error);
      return reply.code(500).send({ error: "Failed to get balances" });
    }
  });

  // Get specific token balance
  app.get("/api/user/balances/:tokenAddress", async (req: FastifyRequest<{ Params: { tokenAddress: string } }>, reply: FastifyReply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const { tokenAddress } = req.params;

    try {
      const balance = await getUserBalance(user.userId, tokenAddress);
      return reply.send({
        tokenAddress,
        balance,
      });
    } catch (error) {
      console.error("Failed to get user balance:", error);
      return reply.code(500).send({ error: "Failed to get balance" });
    }
  });
}
