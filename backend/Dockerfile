# =========================
# build stage
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

# corepack 自带 pnpm，用 lockfile 装依赖更快更稳
RUN corepack enable

# .npmrc 必须跟 package.json 一起 COPY 进来，pnpm install 才会读到里面的
# `registry=https://registry.npmmirror.com/`，否则在国内服务器走默认 npmjs.org
# 的 build 步会 ERR_SOCKET_TIMEOUT 单步要 15-20 分钟（线上加镜像后 1-2 分钟）
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN pnpm build


# =========================
# runtime stage
# =========================
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8666

# 录音识别用 ffmpeg 解码任意格式音频为 PCM，必须系统级安装
RUN apk add --no-cache ffmpeg

RUN corepack enable

# 同 builder 段：把 .npmrc 一起 COPY，pnpm install 走 npmmirror 镜像
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod \
    && pnpm store prune

COPY --from=builder /app/dist ./dist
# 引导音频等静态资源：/static/... 走 express.static 读 public/
COPY public ./public

EXPOSE 8666
CMD ["node", "dist/index.js"]
