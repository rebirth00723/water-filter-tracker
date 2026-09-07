# builder 與 runner 必須用同一個 base image：better-sqlite3 是原生模組，
# 在 Debian 編出來的 .node 放進 Alpine 會出現 invalid ELF header
ARG NODE_VERSION=22.20.0-bookworm-slim

# ---------- 1. 相依安裝 ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# better-sqlite3 若當前平台沒有 prebuild 就需要現場編譯
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# 刻意不用 --mount=type=cache：目標 NAS 的 Docker 沒有 buildx，
# 舊版 builder 不支援 cache mount 與 syntax 指令，會直接失敗
RUN npm ci --no-audit --no-fund

# ---------- 2. 建置 ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 3. 執行 ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# Debian slim 不含 tzdata。日期運算本身走 Intl + Node 內建 ICU，不依賴它；
# 裝它是為了讓 log 時間戳與 Date#toString 顯示正確
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Taipei
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8085
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/app.sqlite3

COPY --from=builder /app/public ./public
RUN mkdir .next
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# migration 的 .sql 是純資料檔，不是 import 目標，output tracing 追不到，必須手動搬。
#（better-sqlite3 反而不用手動搬 —— tracing 會連 prebuilds/*.node 一起帶走）
COPY --from=builder /app/drizzle ./drizzle

# 不寫死 USER：每台主機的 uid 都不一樣（一般 Linux 常是 1000、Synology 可能 1026、
# LXC 又不同），寫死會讓容器對 bind 進來的目錄沒有寫入權限，
# 症狀是很沒幫助的 SQLITE_CANTOPEN。執行身分交由 compose 的 user: 決定。
RUN mkdir -p /data && chmod 0777 /data .next
VOLUME ["/data"]

EXPOSE 8085
CMD ["node", "server.js"]
