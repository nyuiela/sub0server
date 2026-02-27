# Backend + agent-worker. Build: docker build -t sub0server . 
# Run server: docker run --env-file .env -p 4000:4000 sub0server node dist/server.js
# Run worker: docker run --env-file .env -e AGENT_TRADING_ENABLED=true sub0server node dist/workers/agent-worker.js

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 4000

CMD ["node", "dist/server.js"]
