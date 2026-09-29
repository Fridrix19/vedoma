# syntax=docker/dockerfile:1
# UniFlow: сервер (бот MAX + API) и собранный фронт (Mini App + панель) в одном образе.

# ——— 1. Сборка фронта ———
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts vite.demo.config.ts index.html miniapp.html panel.html ./
COPY src ./src
COPY server ./server
# Проверка типов + сборка фронта в режиме работы с сервером
RUN npm run build

# ——— 2. Рабочий образ ———
FROM node:22-alpine
WORKDIR /app
# pdftoppm — картинка-превью первой страницы PDF для Mini App
RUN apk add --no-cache poppler-utils
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# Сертификат Минцифры: без него Node.js не доверяет API MAX (platform-api2.max.ru)
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data \
    DIST_DIR=/app/dist \
    NODE_EXTRA_CA_CERTS=/app/certs/russian_trusted_root_ca.pem
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/shared ./src/shared
COPY certs ./certs
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1
CMD ["node", "--import", "tsx", "server/index.ts"]
