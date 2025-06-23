# 📦 Этап 1: build
FROM node:20 AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm prune --production


# 🏃 Этап 2: runtime
FROM node:20-slim
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://dev:devpass@db:5432/btc

EXPOSE 8080
CMD ["npx", "tsx", "scripts/binance-server.ts"]


