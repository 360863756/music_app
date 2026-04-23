#!/usr/bin/env bash
# ============================================================
# 把 backend/ 打包成可直接上服务器跑的 app_backend/ + app_backend.tar.gz
#
# 用法（在项目根或任意目录都可）：
#   bash scripts/pack-backend.sh            # 生成目录 + tarball
#   bash scripts/pack-backend.sh --no-tar   # 只生成 app_backend/ 目录
#   bash scripts/pack-backend.sh --clean    # 删除 app_backend/ 和 tarball 后退出
#
# 前置：
#   - 已写好 backend/Dockerfile / docker-compose.yml / .env.example
#   - 想把本地数据带上服务器：先把 mysqldump 结果放到 backend/database/10-dump.sql
# ============================================================
set -euo pipefail

# --- 路径 ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/backend"
OUT="$ROOT/app_backend"
TAR="$ROOT/app_backend.tar.gz"

MODE="full"
case "${1:-}" in
  --no-tar) MODE="no-tar" ;;
  --clean)  MODE="clean"  ;;
  "" )      MODE="full"   ;;
  *)
    echo "❌ 未知参数：$1"
    echo "   用法：bash scripts/pack-backend.sh [--no-tar|--clean]"
    exit 1
    ;;
esac

if [[ "$MODE" == "clean" ]]; then
  rm -rf "$OUT" "$TAR"
  echo "✅ 已清理 $OUT 和 $TAR"
  exit 0
fi

# --- 前置校验 ---
need_files=(
  "$SRC/Dockerfile"
  "$SRC/docker-compose.yml"
  "$SRC/.env.example"
  "$SRC/package.json"
  "$SRC/pnpm-lock.yaml"
  "$SRC/tsconfig.json"
  "$SRC/database/init.sql"
)
missing=0
for f in "${need_files[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "❌ 缺失文件：${f#$ROOT/}"
    missing=1
  fi
done
if [[ $missing -ne 0 ]]; then
  exit 1
fi

# dump 是可选但强烈建议
DUMP="$SRC/database/10-dump.sql"
if [[ ! -f "$DUMP" ]]; then
  echo "⚠️  backend/database/10-dump.sql 不存在"
  echo "   服务器首启会得到一个空库（只有 init.sql 建库，没有任何表/数据）"
  echo "   继续执行？[y/N] "
  read -r reply
  if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
    echo "已中止。请先参考 DEPLOY.md 第 1 步生成 dump 后再试。"
    exit 1
  fi
fi

# --- 清理旧产物 ---
rm -rf "$OUT" "$TAR"
mkdir -p "$OUT"

# --- 拷贝 ---
# 不用 rsync（Git Bash 默认没装）；用 cp -a 手动排除
# 直接遍历 backend/ 一级条目，过滤掉本地产物与密钥文件
shopt -s dotglob nullglob
for entry in "$SRC"/*; do
  name="$(basename "$entry")"
  skip=0
  case "$name" in
    node_modules|dist|.DS_Store) skip=1 ;;
    .env)                        skip=1 ;;  # 真实密钥
    .env.example)                skip=0 ;;  # 模板要留
    .env.*)                      skip=1 ;;  # 其他 .env.xxx 视作本地
    *.log)                       skip=1 ;;
  esac
  if [[ $skip -eq 1 ]]; then continue; fi
  cp -a "$entry" "$OUT/"
done
shopt -u dotglob nullglob

# --- 输出 ---
# Windows Git Bash 下 tar 自带；cf -czf 压缩后方便 scp
if [[ "$MODE" == "full" ]]; then
  # 用 -C 让压缩包里根是 app_backend/
  tar -czf "$TAR" -C "$ROOT" "$(basename "$OUT")"
fi

echo ""
echo "=============================="
echo "  打包完成"
echo "=============================="
echo "目录：$OUT"
du -sh "$OUT" | sed 's/^/  大小：/'
if [[ -f "$TAR" ]]; then
  echo "归档：$TAR"
  du -sh "$TAR" | sed 's/^/  大小：/'
fi
echo ""
if [[ -f "$DUMP" ]]; then
  du -sh "$DUMP" | sed 's/^/  含 dump：/'
else
  echo "  含 dump：无（服务器会是空库）"
fi
echo ""
echo "下一步："
if [[ -f "$TAR" ]]; then
  echo "  scp '$TAR' user@your-server:/tmp/"
  echo "  ssh user@your-server"
  echo "  # 在服务器上："
  echo "  mkdir -p /opt/run_app && cd /opt/run_app"
  echo "  tar -xzf /tmp/$(basename "$TAR")"
  echo "  cd app_backend"
  echo "  cp .env.example .env && vi .env"
  echo "  docker compose up -d --build"
else
  echo "  直接把 $OUT/ 整个目录 rsync/scp 到服务器 /opt/run_app/app_backend/"
fi
