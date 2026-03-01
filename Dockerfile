# Backend + agent-worker. Build: docker build -t sub0server .
# Run server: docker run --env-file .env -p 4000:4000 sub0server node dist/server.js
# Run worker: docker run --env-file .env -e AGENT_TRADING_ENABLED=true sub0server node dist/workers/agent-worker.js

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./

# Production image (default target)
FROM base AS prod
COPY prisma ./prisma
RUN pnpm install --prod
RUN pnpm exec prisma generate
COPY . .
RUN pnpm build
EXPOSE 4000
CMD ["node", "dist/server.js"]

# Dev image: full install for tsx/watch; use with docker-compose.dev.yml (volume mount + pnpm dev)
FROM base AS dev
COPY prisma ./prisma
RUN pnpm install && pnpm exec prisma generate
COPY . .
EXPOSE 4000
CMD ["pnpm", "run", "dev"]
