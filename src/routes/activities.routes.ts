import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActivities } from "../services/activities.service.js";
import { activitiesQuerySchema, type ActivitiesQueryInput } from "../schemas/activity.schema.js";

export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/activities", async (req: FastifyRequest<{ Querystring: ActivitiesQueryInput }>, reply: FastifyReply) => {
    const parsed = activitiesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { marketId, userId, agentId, positionId, types, limit, offset } = parsed.data;
    const result = await getActivities({
      marketId,
      userId,
      agentId,
      positionId,
      types,
      limit,
      offset,
    });
    return reply.send(result);
  });
}
