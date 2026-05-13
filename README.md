# Wanderlust

这是一个基于 Gin、MongoDB、Redis、Nginx 和 Vite React 的现代博客示例项目。

## 结构

- `backend/`: Go + Gin 博客 API，使用 MongoDB 持久化文章并提供管理端写作、图片上传接口
- `frontend/`: Vite + React 前端，包含首页、文章详情页和管理端入口
- `nginx/`: Nginx 反向代理配置与前端静态资源镜像构建

## 功能

- 首页文章列表与关键词过滤
- 文章详情页
- 管理端写作入口与新文章发布
- 管理端图片上传接口与 `/media` 静态资源目录
- MongoDB 持久化与 Markdown 正文渲染
- Redis 持久化图片指纹索引，避免重复上传同一张图
- 后端按固定间隔扫描文章正文里的 `/media/...` 引用，自动回收未引用图片并清理 Redis 去重键
- MongoDB 数据卷持久化与归档备份脚本
- Gin 提供 `/api/posts`、`/api/posts/:slug` 与 `POST /api/posts`
- Gin 提供 `POST /api/admin/uploads/images`，管理端上传图片后可直接插入 Markdown
- Nginx 提供 HTTPS 入口，并将 HTTP 自动跳转到 HTTPS
- Nginx 统一代理 `/api`，服务前端静态文件，并公开 `/media`
- Docker Compose 一键启动

## 环境拆分

- 根目录 `.env` 是本地测试默认配置：使用 `localhost`、本地 `certs/` 证书目录，并给 MongoDB / Go build / 前端 build 更宽松的资源参数，适合本地并发构建。
- 根目录 `.env.deploy` 是部署配置：保留 `wanderlust0736.top`、Let's Encrypt 路径和 `1CPU/1GB` VPS 的低内存参数，部署脚本会显式使用它。
- `./scripts/up-local.sh` 会按本地环境启动整套 Compose，并保留 Compose 默认并发。
- `./scripts/update-deploy.sh` 会按部署环境串行备份、停止当前容器、拉代码、构建和重新启动；`./scripts/update-low-memory.sh` 现在只是它的兼容别名。

## 本地开发

### 后端

```bash
cd backend
go mod tidy
export MONGODB_URI=mongodb://localhost:27017
export MONGODB_DATABASE=wanderlust
export BLOG_WRITE_TOKEN=替换成一个长随机字符串
# 如果你希望本地图片上传也启用 Redis 去重，再额外配置：
# export REDIS_ADDR=localhost:6379
# 可选：调整未引用图片清理间隔，默认 24h；设为 0 / off 可关闭
# export BLOG_MEDIA_CLEANUP_INTERVAL=12h
go run .
```

服务默认运行在 `http://localhost:8080`，本地上传图片默认写到 `backend/uploads/`，并通过 `http://localhost:8080/media/...` 访问。

本地开发前请先确保 MongoDB 已启动；如果使用默认地址，可省略上述环境变量。

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`，并通过 Vite 代理访问后端 `/api` 与 `/media`。

## Docker 部署

```bash
docker compose --env-file .env.deploy build blog-api
docker compose --env-file .env.deploy build blog-web
docker compose --env-file .env.deploy up -d mongodb redis blog-api blog-web
```

启动后主站访问地址为 `https://wanderlust0736.top`。

Compose 模式下会启动 MongoDB、Redis、API 和 Nginx，外部暴露 Nginx 的 `80` 与 `443` 端口，其中 `80` 会自动跳转到 HTTPS，API 通过 `https://wanderlust0736.top/api` 访问，上传图片通过 `https://wanderlust0736.top/media/...` 访问。

MongoDB 现在会挂载 Compose 命名卷 `mongodb-data` 到 `/data/db`，容器重建后文章数据仍会保留。

管理端图片上传会把文件写进 Compose 命名卷 `blog-media`，由 `blog-api` 写入、`blog-web` 只读挂载并对外服务；Redis 会记录图片内容摘要到已存在路径的映射，重复上传同一张图时直接复用已有 `/media/...` 地址。

后端默认每 `24h` 会扫描所有文章正文里的 `/media/...` 引用，删除磁盘上未被任何文章引用的媒体文件，并同步删除对应的 Redis 摘要键；如需调短、调长或关闭，可设置 `BLOG_MEDIA_CLEANUP_INTERVAL`，其中 `0`、`off`、`false` 表示禁用。

如果你的 VPS 只有 `1GB` 内存，当前仓库也已经提供默认低内存优化：

- MongoDB 默认把 WiredTiger cache 压到 Mongo 7 允许的最低值 `0.25GB`
- Go API 默认设置 `GOMEMLIMIT=120MiB` 与 `GOGC=75`
- 前端 Docker build 默认把 Node heap 限制到 `256MB`
- 首次部署和日常更新都默认按串行 build 处理，避免 `up --build` 并行构建把内存顶满
- 可直接执行 `./scripts/update-deploy.sh` 按同一套串行方式更新服务

当前镜像不再内置自签名证书，而是要求在启动时挂载外部证书文件。`www.wanderlust0736.top` 会被 Nginx 统一 301 跳转到 `wanderlust0736.top`。

如果你要使用 `/admin` 管理端发布文章或上传图片，必须先配置 `BLOG_WRITE_TOKEN`。前台访客不会在导航里看到这个入口；后端只会对带正确 Bearer token 的写操作放行，未配置时这些端点会直接返回 `503`。旧的 `/write` 路径会自动跳转到 `/admin`。

### 数据备份与恢复

仓库里已经补了两条与 MongoDB 内容备份相关的脚本：

- `./scripts/backup-mongodb.sh`：把当前 `wanderlust` 数据库导出为 gzip archive
- `./scripts/restore-mongodb.sh <备份目录或 archive 文件>`：把归档恢复回 MongoDB

手动备份示例：

```bash
./scripts/backup-mongodb.sh
```

默认输出目录是 `./backups/mongodb/`，每次会生成形如 `wanderlust-20260512T123456Z/dump.archive.gz` 的备份目录，并附带 `metadata.txt` 与可用时的 `sha256` 校验文件。

恢复示例：

```bash
./scripts/restore-mongodb.sh ./backups/mongodb/wanderlust-20260512T123456Z
```

恢复前默认会清空目标数据库；如果你想保留现有内容再尝试恢复，可以先设置：

```bash
export BLOG_BACKUP_RESTORE_DROP=0
```

如果你要把备份接到定时任务，仓库里也已经准备好了模板：

- `deploy/systemd/wanderlust-mongodb-backup.service`
- `deploy/systemd/wanderlust-mongodb-backup.timer`
- `deploy/cron/wanderlust-mongodb-backup.cron`

安装 `systemd timer` 的最短路径：

```bash
sudo cp deploy/systemd/wanderlust-mongodb-backup.service /etc/systemd/system/
sudo cp deploy/systemd/wanderlust-mongodb-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wanderlust-mongodb-backup.timer
```

### 证书挂载

默认会把仓库根目录下的 `./certs` 挂载到容器里的 `/etc/nginx/certs`，并读取下面两个文件：

- `fullchain.pem`
- `privkey.pem`

如果你使用 Let's Encrypt，不要只挂 `live/wanderlust0736.top` 这一层，因为其中的 `fullchain.pem` 和 `privkey.pem` 通常是符号链接。更稳妥的方式是把整棵 `/etc/letsencrypt` 挂进容器，再把读取路径指到 `live/wanderlust0736.top`：

```bash
export BLOG_TLS_CERTS_DIR=/etc/letsencrypt
export BLOG_TLS_CERT_PATH=/etc/nginx/certs/live/wanderlust0736.top/fullchain.pem
export BLOG_TLS_KEY_PATH=/etc/nginx/certs/live/wanderlust0736.top/privkey.pem
docker compose --env-file .env.deploy up --build -d
```

如果当前机器只有 `1GB` 内存，更稳妥的方式仍然是：

```bash
docker compose --env-file .env.deploy build blog-api
docker compose --env-file .env.deploy build blog-web
docker compose --env-file .env.deploy up -d mongodb redis blog-api blog-web
```

如果你使用云证书但文件名不是 `fullchain.pem` 和 `privkey.pem`，可以继续挂载目录，同时指定容器内实际读取的文件名：

```bash
export BLOG_TLS_CERTS_DIR=./certs
export BLOG_TLS_CERT_PATH=/etc/nginx/certs/server.crt
export BLOG_TLS_KEY_PATH=/etc/nginx/certs/server.key
docker compose --env-file .env.deploy up --build -d
```

低内存机器上也建议改成先分别 build `blog-api` 和 `blog-web`，再执行 `docker compose --env-file .env.deploy up -d mongodb redis blog-api blog-web`。

如果挂载目录里缺少证书文件，Nginx 容器会在启动前直接报错退出，避免带着错误配置继续运行。

### Let’s Encrypt 自动续期后重载

当前 `blog-web` 默认启用了证书文件轮询。只要宿主机上的 Let’s Encrypt 续期任务把证书更新到挂载目录里，容器会在下一个轮询周期内自动执行 `nginx -s reload`，不需要手动重启容器。

- 默认开关：`BLOG_TLS_AUTO_RELOAD=1`
- 默认轮询间隔：`BLOG_TLS_RELOAD_INTERVAL_SECONDS=60`

如果你希望调短或关闭：

```bash
export BLOG_TLS_AUTO_RELOAD=1
export BLOG_TLS_RELOAD_INTERVAL_SECONDS=30
docker compose up --build -d
```

如果是在 `1GB` VPS 上操作，仍然优先使用串行 build 再 `up -d` 的方式。

### Certbot 部署脚本

仓库里已经补了两条可直接执行的脚本：

- `./scripts/deploy-letsencrypt.sh`：首次申请证书并启动整套 Compose 服务
- `./scripts/renew-letsencrypt.sh`：执行一次续期检查，续期成功后由 `blog-web` 自动检测证书变化并热重载 Nginx

首次部署示例：

```bash
export CERTBOT_EMAIL=you@example.com
./scripts/deploy-letsencrypt.sh
```

手动续期示例：

```bash
./scripts/renew-letsencrypt.sh
```

如果你要把续期接到 cron，可以直接用：

```bash
cd /home/ssy/web && ./scripts/renew-letsencrypt.sh >> /var/log/wanderlust-certbot.log 2>&1
```

仓库里也已经直接生成了相关脚本和配置：

- `scripts/install-cert-renew-timer.sh`
- `deploy/systemd/wanderlust-cert-renew.service`
- `deploy/systemd/wanderlust-cert-renew.timer`
- `deploy/cron/wanderlust-cert-renew.cron`

安装 `systemd timer` 的最短路径：

```bash
./scripts/install-cert-renew-timer.sh
sudo systemctl status wanderlust-cert-renew.timer
```

如果想先预览脚本渲染出的 unit 内容，可以先执行：

```bash
./scripts/install-cert-renew-timer.sh --dry-run
```

如果你更偏向 `cron`，可以直接：

```bash
crontab deploy/cron/wanderlust-cert-renew.cron
```

这两条脚本默认会把 Let’s Encrypt 数据写到仓库下的 `./letsencrypt`，把 ACME challenge webroot 写到 `./certbot/www`，不会覆盖当前 `./certs` 里的本地自签名证书。

当前仓库根目录也已经提供了 `.env`，Compose 默认会按 Let’s Encrypt 目录约定读取：

- `.env`：本地默认，指向 `./certs` 和更宽松的本地资源配置
- `.env.deploy`：部署默认，指向 `./letsencrypt` 和低内存 VPS 配置
- `BLOG_WRITE_TOKEN=`：默认留空，准备启用 `/admin` 管理端写作和图片上传时再填入随机令牌

### Nginx 健康检查与排障

- 新增了 `https://127.0.0.1/nginx-healthz` 健康检查接口，返回当前主域名、证书路径和自动重载配置。
- `blog-web` 已配置 Compose `healthcheck`，会直接探测这个接口。
- 证书监听脚本现在会输出带时间戳的启动日志、证书指纹变化日志，以及 `nginx reload` 成功或失败日志，方便直接用 `docker logs wanderlust-web` 排查。

### Let’s Encrypt 实战演练清单

完整步骤已经单独整理在 `deploy/letsencrypt-drill.md`，适合首次切换、dry-run 续期检查和任务安装后复核时逐项执行。

### 域名上线说明

- 域名 `wanderlust0736.top` 还需要在 DNS 解析里把 `A` 记录指向你的服务器公网 IP。
- 如果要同时支持 `www.wanderlust0736.top`，再加一条 `CNAME` 或 `A` 记录。
- 当前仓库里的 Nginx 会把 `www.wanderlust0736.top` 永久重定向到 `wanderlust0736.top`。
- 如果你希望 `https://www.wanderlust0736.top` 也能顺利跳转，证书里需要同时包含主域名和 `www` 子域名。
- 如果需要在本机继续通过 `https://localhost` 联调，必须使用包含 `localhost` 的本地证书；正式云证书通常只覆盖真实域名。

## 后续可扩展方向

- 增加后台管理与文章编辑权限控制
- 增加评论、归档、RSS 与搜索能力