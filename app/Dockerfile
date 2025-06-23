# 🧱 Этап 1: build-stage
FROM node:20 AS builder

WORKDIR /app

# Копируем только нужные файлы
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Устанавливаем зависимости и генерируем Prisma Client
RUN npm ci

COPY . .
RUN npx prisma generate

RUN npm run build

# 🏗 Этап 2: runtime-stage (только продакшен)
FROM node:20-slim

WORKDIR /app

# Копируем только нужное из builder
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Убедись, что Prisma Client доступен
ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://dev:devpass@db:5432/btc

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]

