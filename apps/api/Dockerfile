# EduStore API (NestJS + Prisma). Контекст сборки = корень монорепо.
#   docker build -f apps/api/Dockerfile -t edustore-api .
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
# зависимости (workspaces)
# ВНИМАНИЕ на порядок: packages/shared копируется ЦЕЛИКОМ до npm install.
# У @edustore/shared есть скрипт prepare (tsc -p tsconfig.json), который npm
# выполняет прямо в install. Если к этому моменту лежит только его package.json,
# install падает с TS5058 — и образ не собирается вовсе.
COPY package.json package-lock.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
RUN npm install
# исходники
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm --workspace apps/api run build

FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
WORKDIR /app/apps/api
EXPOSE 3000
# применяем миграции и запускаем (сид — отдельной командой при первом деплое)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
