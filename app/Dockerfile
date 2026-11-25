# 1단계: 화면 빌드 (alpine(musl) 은 스택이 작아 Rollup 빌드가 깨져서 slim 을 써요)
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2단계: Node 서버 하나로 화면 · 투표 · 저장 (루트 아닌 사용자, 따로 설치하는 것 없음)
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/web DATA_DIR=/data LISTEN_PORT=8080 NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY --from=build /app/dist ./web
COPY server.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server.mjs"]
