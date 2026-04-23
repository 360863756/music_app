# 后端部署说明（Docker Compose）

目标：Linux VPS，Docker + Docker Compose；一套容器跑后端 API（`:8666`）和 MySQL；本地数据通过 `mysqldump` 带过去首启自动导入；暂先按 IP + 端口访问，不做 Nginx / HTTPS。

> 约定：文中所有路径都基于本仓库的 `backend/` 目录。把 `backend/` 整体上传即可，不需要根目录的 `app/`。

---

## 0. 服务器先装 Docker

Ubuntu / Debian 一键脚本：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version && docker compose version
```

确认 Compose 用的是 `docker compose`（V2 插件）而不是老的 `docker-compose`。

---

## 1. 本地：导出数据库 dump

在能访问本地 MySQL 的机器上执行：

```bash
# 本地 MySQL 端口是 3308（见 src/config/database.ts 默认值）；按你实际环境改
mysqldump \
  -h 127.0.0.1 -P 3308 -uroot -p \
  --databases run_app \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --routines --triggers \
  > backend/database/10-dump.sql
```

几个要点：
- `--databases run_app`：dump 里会带 `CREATE DATABASE` / `USE run_app`，导入时不用再手动建库。
- 文件名前缀 `10-`：MySQL 首启时按字母序扫 `/docker-entrypoint-initdb.d/`，保证在 `init.sql` 之后执行（`init.sql` 是幂等的建库语句，有也无妨）。
- `backend/database/*.sql` 已被 `.gitignore` 排除，避免真实用户/曲库数据进仓库。

---

## 2. 把 `backend/` 传到服务器

任选一种：

```bash
# 方案 A：scp（简单粗暴）
scp -r backend user@your-server:/opt/run_app/

# 方案 B：rsync（反复部署时增量，推荐）
rsync -avz --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude '.env' \
  backend/ user@your-server:/opt/run_app/backend/
```

之后 SSH 登录服务器，进入 `/opt/run_app/backend/`。

---

## 3. 服务器：写 `.env`

```bash
cd /opt/run_app/backend
cp .env.example .env
# 用 openssl 生成强随机值再贴进 .env
openssl rand -base64 24   # 用作 MYSQL_ROOT_PASSWORD
openssl rand -hex 32      # 用作 JWT_SECRET
vi .env
```

`.env` 内容示例：

```
MYSQL_ROOT_PASSWORD=xxxxxxxxxxxxxxxxxxxxxxxx
MYSQL_DATABASE=run_app
JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 4. 首次部署：构建并启动

```bash
docker compose up -d --build
docker compose logs -f db    # 等到看到 "ready for connections"，再看 api
docker compose logs -f api   # 看到 "Server is running on port 8666" 即启动完成
```

MySQL **首次**启动（`mysql_data` 卷为空）会自动按字母顺序执行 `database/*.sql`，也就是：
1. `init.sql`（建库）
2. `10-dump.sql`（你的表结构 + 数据）

健康检查：

```bash
curl http://127.0.0.1:8666/api/health
# {"status":"ok","message":"Server is running"}
```

> 如果安全组 / ufw 开了 8666，外网即可用 `http://<server-ip>:8666` 访问。
> 端口未放行时：`ufw allow 8666/tcp` 或在云控制台放行。

---

## 5. 常用运维命令

```bash
# 重启 API（代码更新后）
docker compose up -d --build api

# 查看日志
docker compose logs -f --tail=200 api
docker compose logs -f --tail=200 db

# 进入 MySQL
docker compose exec db mysql -uroot -p run_app

# 进入 API 容器排查
docker compose exec api sh

# 停止
docker compose stop

# 彻底清理（会删除数据卷 mysql_data！）
docker compose down -v
```

---

## 6. 代码 / dump 更新后怎么做

### 情况 A：只改了后端代码
```bash
cd /opt/run_app/backend
# 把最新的 src/、package.json、pnpm-lock.yaml 等同步上去
docker compose up -d --build api
```
不会动 MySQL 数据。

### 情况 B：想重新用最新 dump 刷一次数据库（线上还没上正式用户时）
```bash
# 注意：这会删除容器里所有数据！
docker compose down -v
# 替换 backend/database/10-dump.sql 为新 dump
docker compose up -d --build
```

### 情况 C：线上已有用户，只想补表结构 / 追加数据
**不要**执行 `down -v`；改成手动导入到现有数据库：
```bash
docker compose cp backend/database/10-dump.sql db:/tmp/patch.sql
docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" run_app < /tmp/patch.sql'
```
或者用专门的 SQL 迁移脚本，避免覆盖现有用户数据。

---

## 7. 后续再加 Nginx / HTTPS（有域名时）

目前是直接 `:8666` 对外。有域名后再做：
1. 在宿主机装 nginx，`proxy_pass http://127.0.0.1:8666`
2. 用 certbot 申请 Let's Encrypt 证书
3. 把 compose 里 `api.ports` 改成 `"127.0.0.1:8666:8666"`，只对本机开放，由 nginx 代理

这部分需要时再加，现在可以不管。

---

## 8. 前端 App 记得改 API Host

前端代码里的 baseURL 通常类似 `http://192.168.x.x:8666` 或本机调试地址，上线前记得改成服务器 IP（或域名）。这个不在后端仓里，改完重新打包。
