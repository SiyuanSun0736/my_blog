# 云服务器部署命令

这份文档面向刚刚 `git clone` 完仓库、准备首次上线 `wanderlust0736.top` 的场景。

## 当前环境记录

- 当前这台服务器只用于开发验证，不作为正式生产环境。
- 当前开发部署主机公网 IP：`47.79.86.69`
- 当前 VPS 只有 `1GB` 内存，部署和更新默认按低内存模式处理。
- 当前部署相关脚本默认读取根目录 `.env.deploy`；建议先由仓库里的 `.env.deploy.example` 复制生成。实际 `.env.deploy` 不再纳入 git 跟踪，本地开发继续使用根目录 `.env`。
- 当前仓库在这台机器上的更新，默认按“先备份数据库，再停止当前服务，再更新代码、重建网页和 API，最后验证”的顺序执行。

## 1GB VPS 优化

当前仓库已经针对 `1GB` 内存的 VPS 做了几项默认优化：

- MongoDB 使用 `MONGODB_WIREDTIGER_CACHE_GB=0.25`，把 WiredTiger 缓存压到 Mongo 7 允许的最低值 `256MB`
- Go API 使用 `GIN_MODE=release`、`BLOG_API_GOMEMLIMIT=120MiB` 和 `BLOG_API_GOGC=50`，降低运行时内存峰值
- 后端镜像构建使用 `BLOG_API_BUILD_GOMEMLIMIT=120MiB`、`BLOG_API_BUILD_GOGC=50` 和 `BLOG_API_BUILD_P=1`，让 `go build` 在 1GB VPS 上按单并行、低内存模式编译
- 后端 Docker build 复用 Go module/build cache，避免每次部署都从零开始编译同一批依赖
- 更新脚本默认用 `WANDERLUST_BUILD_NICE_LEVEL=10` 降低 build 调度优先级，减轻构建阶段对在线容器的 CPU 抢占
- 前端构建使用 `FRONTEND_BUILD_MAX_OLD_SPACE_SIZE=256`，限制 Node build heap
- Vite 关闭压缩体积统计，减少构建时额外内存开销
- 更新脚本改为串行 build `blog-api` 和 `blog-web`，避免 1GB VPS 同时构建把内存顶满
- `blog-api` 镜像现已内置 Chromium、KaTeX 资源与 CJK 字体，用于 LaTeX / 表格 / SVG 的局部 PDF 渲染；相较纯 gofpdf 方案仍会多一些体积和内存，但同一份 PDF 已改为复用单个浏览器会话，已避开整页打印和逐段反复启动 Chromium 的峰值开销

这些默认值已经写进根目录 `.env.deploy.example`。服务器实际部署时，复制成 `.env.deploy` 后再按机器情况覆盖。当前前端构建已经在 `256MB` Node heap 下完成验证；后端镜像构建也已经改成单并行 `go build`。如果后续页面体积再次上升，可以先回到 `320` 做对比，再根据实际构建日志微调。如果 Mongo 压力偏大，再把 `MONGODB_WIREDTIGER_CACHE_GB` 上调到 `0.30` 或 `0.35`。

## 前置条件

- 域名 `wanderlust0736.top` 和 `www.wanderlust0736.top` 已经解析到这台服务器
- 服务器已安装 Docker 和 Docker Compose
- 服务器安全组、防火墙已放行 `80` 和 `443`
- 当前仓库已经 clone 到服务器某个目录，例如 `/home/ubuntu/my_blog`

## 首次上线

把下面命令里的目录替换成你服务器上的实际仓库目录。

```bash
cd /你的仓库目录

git pull
test -f .env.deploy || cp .env.deploy.example .env.deploy
chmod +x scripts/deploy-letsencrypt.sh scripts/renew-letsencrypt.sh

export CERTBOT_EMAIL=你的邮箱
export BLOG_WRITE_TOKEN=替换成一个长随机字符串

./scripts/deploy-letsencrypt.sh
```

这组命令会做几件事：

- 拉取最新代码
- 给部署脚本执行权限
- 用 Let's Encrypt 为主域名和 `www` 申请证书
- 构建并启动 MongoDB、Redis、后端 API 和 Nginx 前端容器
- 创建并挂载 MongoDB 数据卷、Redis 数据卷和图片媒体卷，避免容器重建时丢文章、上传图片和去重索引

如果你准备使用 `/admin` 管理端发布文章或上传图片，记得在首次启动前就把 `BLOG_WRITE_TOKEN` 设好；前台访客不会在导航里看到这个入口，但直接访问管理端时仍然需要令牌验证。

当前上传链路是：管理端调用 `POST /api/admin/uploads/images`，`blog-api` 把图片写进共享媒体卷，Nginx 直接对外公开 `/media/...`，Redis 记录图片摘要到路径的映射，重复上传同一张图会直接复用已有地址。

如果你发现容器内 Chromium 渲染 LaTeX / 表格 / SVG 片段时抓不到 `/media/...` 或站内链接资源，可以在 `.env.deploy` 里额外设置 `BLOG_PDF_BASE_URL`，把它固定到 `blog-api` 自己可访问的地址，例如 `http://127.0.0.1:8080`。

如果你不是走容器部署，而是直接在宿主机启动 `blog-api`，LaTeX 局部渲染会优先读取本地 KaTeX 资源；默认会尝试使用仓库里的 `frontend/node_modules/katex/dist`，也可以通过 `BLOG_PDF_KATEX_DIR` 显式指定目录。

### 如果首次部署时漏了 `BLOG_WRITE_TOKEN`

这不影响公开页面和文章接口；影响的是 `/admin` 管理端写权限和图片上传。当前后端在 `BLOG_WRITE_TOKEN` 为空时会直接返回 `503 write access is not configured`，所以补上 token 后只需要重建 `blog-api` 容器，不需要重建 MongoDB、Redis，也不需要重建前端。

推荐把 token 直接写进根目录 `.env.deploy`，这样后续重启后不会丢；该文件现在默认不进 git：

```bash
cd /你的仓库目录

# 编辑根目录 .env.deploy，把这一行改成你自己的长随机字符串
BLOG_WRITE_TOKEN=替换成一个长随机字符串

docker compose --env-file .env.deploy up -d --force-recreate --no-deps blog-api
```

如果你只是想先临时补上，再决定是否写回 `.env`，也可以当前 shell 里先导出后重建：

```bash
cd /你的仓库目录

export BLOG_WRITE_TOKEN=替换成一个长随机字符串
docker compose --env-file .env.deploy up -d --force-recreate --no-deps blog-api
```

补完后可以直接验证：

```bash
cd /你的仓库目录

curl -sk https://127.0.0.1/api/write-access \
	-H 'Host: wanderlust0736.top' \
	-H 'Authorization: Bearer 你的新token'
```

如果返回 `{"message":"write access granted"}`，说明新的 `BLOG_WRITE_TOKEN` 已经生效。

## 上线后检查

```bash
cd /你的仓库目录

docker compose --env-file .env.deploy ps
docker logs wanderlust-web --since 10m
docker exec wanderlust-web wget -q --no-check-certificate -O - https://127.0.0.1/nginx-healthz
```

如果你还想确认 `www` 是否已经跳转到主域名，再执行：

```bash
cd /你的仓库目录

curl -k -I https://127.0.0.1 -H 'Host: www.wanderlust0736.top'
```

预期结果：

- `docker compose ps` 里 `wanderlust-web` 是 `healthy`
- `nginx-healthz` 返回的 `certificate` 路径是 `/etc/nginx/certs/live/wanderlust0736.top/fullchain.pem`
- `www.wanderlust0736.top` 返回 `301` 并跳到 `https://wanderlust0736.top/`

## 线上 Smoke Test 清单

这组检查只验证三件事：管理端上传接口可用、Nginx 能直接把图片从 `/media/...` 对外提供、Redis 去重键能命中相同文件。

建议在仓库根目录执行，默认使用 `.env.deploy`。为了避免在线上残留大文件，下面示例会生成一张 1x1 PNG 作为测试图片。

### 0. 准备环境变量和测试图片

```bash
cd /你的仓库目录

set -a
. ./.env.deploy
set +a

# 如果 .env.deploy 里还没填 BLOG_WRITE_TOKEN，这里手动补一个当前有效值
export BLOG_WRITE_TOKEN='替换成当前可用的管理端 token'

tmp_dir=$(mktemp -d)
cat <<'EOF' | base64 -d > "$tmp_dir/wanderlust-smoke.png"
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9kAAAAASUVORK5CYII=
EOF

sha256=$(sha256sum "$tmp_dir/wanderlust-smoke.png" | awk '{print $1}')
printf 'local sha256: %s\n' "$sha256"
```

预期结果：能生成 `wanderlust-smoke.png`，并打印一条本地文件 sha256。

### 1. 第一次上传，验证上传接口

```bash
status_1=$(curl -sk \
	-o "$tmp_dir/upload-1.json" \
	-w '%{http_code}' \
	"https://127.0.0.1/api/admin/uploads/images" \
	-H "Host: $BLOG_PRIMARY_DOMAIN" \
	-H "Authorization: Bearer $BLOG_WRITE_TOKEN" \
	-F "file=@$tmp_dir/wanderlust-smoke.png;type=image/png")

cat "$tmp_dir/upload-1.json"
printf 'upload status #1: %s\n' "$status_1"

media_path_1=$(sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$tmp_dir/upload-1.json")
cached_1=$(sed -n 's/.*"cached":\([^,}]*\).*/\1/p' "$tmp_dir/upload-1.json")

printf 'media path #1: %s\n' "$media_path_1"
printf 'cached flag #1: %s\n' "$cached_1"
```

预期结果：

- `upload status #1` 是 `201`
- 返回 JSON 里有 `/media/YYYY/MM/<sha256>.png` 形式的 `path`
- `cached flag #1` 是 `false`

### 2. 验证 Nginx 直出 `/media/...`

```bash
curl -skI "https://127.0.0.1${media_path_1}" -H "Host: $BLOG_PRIMARY_DOMAIN"

remote_sha256=$(curl -sk "https://127.0.0.1${media_path_1}" -H "Host: $BLOG_PRIMARY_DOMAIN" | sha256sum | awk '{print $1}')
printf 'remote sha256: %s\n' "$remote_sha256"

test "$remote_sha256" = "$sha256"
printf 'nginx media hash check: ok\n'
```

预期结果：

- `HEAD` 响应是 `200 OK`
- 头里能看到 `Content-Type: image/png`
- 头里能看到 `Cache-Control: public, max-age=2592000, immutable`
- `remote sha256` 与上一步本地文件 sha256 完全一致

### 3. 第二次上传同一文件，验证 Redis 去重命中

```bash
status_2=$(curl -sk \
	-o "$tmp_dir/upload-2.json" \
	-w '%{http_code}' \
	"https://127.0.0.1/api/admin/uploads/images" \
	-H "Host: $BLOG_PRIMARY_DOMAIN" \
	-H "Authorization: Bearer $BLOG_WRITE_TOKEN" \
	-F "file=@$tmp_dir/wanderlust-smoke.png;type=image/png")

cat "$tmp_dir/upload-2.json"
printf 'upload status #2: %s\n' "$status_2"

media_path_2=$(sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$tmp_dir/upload-2.json")
cached_2=$(sed -n 's/.*"cached":\([^,}]*\).*/\1/p' "$tmp_dir/upload-2.json")

printf 'media path #2: %s\n' "$media_path_2"
printf 'cached flag #2: %s\n' "$cached_2"

test "$media_path_1" = "$media_path_2"
printf 'same media path check: ok\n'
```

预期结果：

- `upload status #2` 是 `200`
- `cached flag #2` 是 `true`
- `media path #2` 与第一次上传得到的路径完全一致

### 4. 直接检查 Redis 里的去重键

```bash
if [ -n "${REDIS_PASSWORD:-}" ]; then
	redis_value=$(docker compose --env-file .env.deploy exec -T redis \
		redis-cli -a "$REDIS_PASSWORD" GET "wanderlust:media:digest:$sha256")
else
	redis_value=$(docker compose --env-file .env.deploy exec -T redis \
		redis-cli GET "wanderlust:media:digest:$sha256")
fi

printf 'redis value: %s\n' "$redis_value"

test "$redis_value" = "$media_path_1"
printf 'redis dedupe key check: ok\n'
```

预期结果：

- Redis 返回值不为空
- Redis 返回值与第一次上传得到的 `media path #1` 完全一致

### 5. 失败时补查日志

```bash
docker logs wanderlust-api --since 10m
docker logs wanderlust-web --since 10m
docker logs wanderlust-redis --since 10m
```

如果上传失败，优先看 `wanderlust-api`；如果 `/media/...` 取不到文件，优先看 `wanderlust-web`；如果第二次上传没有命中去重，再看 `wanderlust-redis`。

### 6. 测试完成后的清理

```bash
rm -rf "$tmp_dir"
```

说明：这个清理只会删除本机临时文件，不会删除已经写进 `blog-media` 卷里的测试图片。当前仓库还没有独立的图片删除接口，所以线上 smoke test 建议始终使用这种极小测试图。

补充：后端现在会按 `BLOG_MEDIA_CLEANUP_INTERVAL` 定时扫描文章正文里的 `/media/...` 引用，自动删除长期未被任何文章引用的媒体文件，并同步清理对应的 Redis 去重键；Compose 默认值是 `24h`。如果你想更快回收 smoke test 产生的测试图，可以临时把这个环境变量调短后重启 `blog-api`。

## git pull 后更新数据库和网页

当前项目已经把 MongoDB 数据放进命名卷 `mongodb-data`，上传图片放进命名卷 `blog-media`，Redis 索引放进命名卷 `redis-data`，所以日常 `git pull` 更新时，不需要先删库，也不需要重建这些数据卷。默认推荐下面这套顺序：

当前这台 `1GB` VPS 更推荐直接使用仓库里的部署更新脚本：

```bash
cd /你的仓库目录

chmod +x scripts/update-deploy.sh
./scripts/update-deploy.sh
```

这条脚本内部已经固定做了：备份数据库、停止当前 `mongodb`/`redis`/`blog-api`/`blog-web` 容器、`git pull --ff-only`、串行 build `blog-api`、串行 build `blog-web`、重新启动容器、验证文章接口。

默认会读取仓库根目录 `.env.deploy`，并在执行 `git pull --ff-only` 前先检查当前 tracked 文件是否干净；当前脚本里的 `git pull` 已改成非交互模式，如果服务器还没配好免交互拉取，会直接失败而不是卡住。如果你服务器上正准备部署本地未提交改动，可以改用：

```bash
./scripts/update-deploy.sh --skip-pull
```

如果你想在更新完成后顺手看最近日志，可以加上：

```bash
./scripts/update-deploy.sh --logs
```

如果部署环境文件不在默认位置，或者你想先看完整参数说明：

```bash
./scripts/update-deploy.sh --help
./scripts/update-deploy.sh --env-file /你的部署目录/.env.deploy --logs
```

如果你想手动执行，再用下面这套命令：

```bash
cd /你的仓库目录

WANDERLUST_COMPOSE_ENV_FILE=.env.deploy ./scripts/backup-mongodb.sh
docker compose --env-file .env.deploy stop mongodb redis blog-api blog-web
GIT_TERMINAL_PROMPT=0 git pull --ff-only
docker compose --env-file .env.deploy build blog-api
docker compose --env-file .env.deploy build blog-web
docker compose --env-file .env.deploy up -d mongodb redis blog-api blog-web
docker compose --env-file .env.deploy ps
curl -sk https://127.0.0.1/api/posts -H 'Host: wanderlust0736.top'
docker logs wanderlust-api --since 10m
docker logs wanderlust-web --since 10m
```

这组命令分别处理的事情是：

- 先备份当前数据库和图片媒体卷，给回滚留出口
- 备份脚本只会把数据库归档和图片归档写到本机 `backups/`，不会再自动 `git commit` / `git push`，避免定时任务和部署流程卡在 git 认证
- 先停止当前 `mongodb`、`redis`、`blog-api` 和 `blog-web`，再进入部署流程，避免云上构建时继续占用运行时内存
- 非交互拉取最新代码，避免 merge commit 混进服务器更新流程；如果服务器没配好免交互认证，会直接报错退出
- 串行 build `blog-api` 和 `blog-web`，避免 1GB VPS 在构建时同时占用过多内存
- 重启 `mongodb`、`redis`、`blog-api` 和 `blog-web`，但保留当前 MongoDB 数据卷、Redis 数据卷和图片媒体卷
- 用 `docker compose ps`、文章列表接口和最近日志确认网页与 API 都已切到新版本

### 日常更新原则

- 只改前端、后端接口、页面样式、Nginx 配置时：重建 `blog-api` 和 `blog-web` 就够了；Redis 一般不需要重建。
- 当前版本没有独立 migration 系统，所以 `git pull` 后不会自动重写 MongoDB 里的内容。
- 只要你不主动重建或删除 `mongodb-data`、`redis-data` 和 `blog-media` 卷，数据库内容、上传图片与图片去重索引都会继续保留。

### 如果本次改动涉及数据库结构

如果某次更新明确涉及 MongoDB 结构、数据修正、字段回填或清洗，推荐改用下面这套更稳的流程：

```bash
cd /你的仓库目录

WANDERLUST_COMPOSE_ENV_FILE=.env.deploy ./scripts/backup-mongodb.sh
GIT_TERMINAL_PROMPT=0 git pull --ff-only
docker compose --env-file .env.deploy up -d --build blog-api blog-web

# 按本次改动需要执行数据库脚本或手动修正
# 例如：docker compose exec -T mongodb mongosh

docker compose --env-file .env.deploy ps
curl -sk https://127.0.0.1/api/posts -H 'Host: wanderlust0736.top'
docker logs wanderlust-api --since 10m
```

如果更新后发现数据不对，优先回到最近一次备份：

```bash
cd /你的仓库目录

WANDERLUST_COMPOSE_ENV_FILE=.env.deploy ./scripts/restore-mongodb.sh ./backups/mongodb/最近一次备份目录
docker compose --env-file .env.deploy up -d blog-api blog-web
```

### 什么时候才需要重建 MongoDB / Redis 容器

只有下面这些场景，才建议把 `mongodb` 或 `redis` 纳入重建范围：

- `docker-compose.yml` 里 Mongo 或 Redis 镜像版本发生变化
- 你需要验证新的 Mongo 配置是否生效
- Mongo 容器本身异常，且仅重启不能恢复

对应命令：

```bash
cd /你的仓库目录

WANDERLUST_COMPOSE_ENV_FILE=.env.deploy ./scripts/backup-mongodb.sh
GIT_TERMINAL_PROMPT=0 git pull --ff-only
docker compose --env-file .env.deploy build blog-api
docker compose --env-file .env.deploy build blog-web
docker compose --env-file .env.deploy up -d --build mongodb redis blog-api blog-web
docker compose --env-file .env.deploy ps
```

## 手动续期证书

```bash
cd /你的仓库目录

./scripts/renew-letsencrypt.sh
```

做一次演练但不真正替换证书：

```bash
cd /你的仓库目录

CERTBOT_DRY_RUN=1 ./scripts/renew-letsencrypt.sh
```

## 手动备份内容

```bash
cd /你的仓库目录

chmod +x scripts/backup-mongodb.sh scripts/restore-mongodb.sh
./scripts/backup-mongodb.sh
ls backups/mongodb
```

默认备份会输出到 `backups/mongodb/<database>-<timestamp>/`，其中包含 `dump.archive.gz`、`media.tar.gz`、`metadata.txt` 与可用时的校验文件。

当前备份只保留在服务器本机目录，不会自动提交到仓库；`backups/latest-mongodb/` 仍会同步最近一次副本，方便恢复，但生成的数据库归档、图片归档、metadata 和 checksum 文件默认不再进入 git。

恢复示例：

```bash
cd /你的仓库目录

./scripts/restore-mongodb.sh ./backups/mongodb/你的备份目录
```

如果传的是备份目录，脚本会同时恢复其中的 `media.tar.gz`；如果你只想恢复数据库，可以直接传 `dump.archive.gz` 文件，或者先设置 `BLOG_BACKUP_RESTORE_MEDIA=0`。

如果你不想在恢复前先清空当前数据库，可以先执行：

```bash
cd /你的仓库目录

export BLOG_BACKUP_RESTORE_DROP=0
./scripts/restore-mongodb.sh ./backups/mongodb/你的备份目录
```

## 安装自动备份任务

推荐 `systemd timer`。

```bash
cd /你的仓库目录

sudo cp deploy/systemd/wanderlust-mongodb-backup.service /etc/systemd/system/
sudo cp deploy/systemd/wanderlust-mongodb-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wanderlust-mongodb-backup.timer
sudo systemctl status wanderlust-mongodb-backup.timer
```

如果你更想用 `cron`，执行：

```bash
cd /你的仓库目录

crontab deploy/cron/wanderlust-mongodb-backup.cron
crontab -l
```

## 安装自动续期任务

推荐 `systemd timer`。

```bash
cd /你的仓库目录

./scripts/install-cert-renew-timer.sh
sudo systemctl status wanderlust-cert-renew.timer
```

如需先检查脚本会生成什么 unit，可先执行：

```bash
cd /你的仓库目录

./scripts/install-cert-renew-timer.sh --dry-run
```

如果你更想用 `cron`，执行：

```bash
cd /你的仓库目录

crontab deploy/cron/wanderlust-cert-renew.cron
crontab -l
```

## 常用排查命令

查看容器状态：

```bash
cd /你的仓库目录

docker compose ps
```

查看 Nginx 日志：

```bash
cd /你的仓库目录

docker logs wanderlust-web --since 30m
```

查看后端日志：

```bash
cd /你的仓库目录

docker logs wanderlust-api --since 30m
```

查看 MongoDB 日志：

```bash
cd /你的仓库目录

docker logs wanderlust-mongodb --since 30m
```

## 失败时先看这几项

- DNS 是否已经解析到服务器公网 IP
- 服务器 `80/443` 端口是否对外开放
- `CERTBOT_EMAIL` 是否已设置
- 是否有其他服务占用了 `80` 或 `443`
- `docker logs wanderlust-web --since 10m` 里是否有证书校验或重载失败日志

## 如果 Certbot 报 no valid A records 或 NXDOMAIN

先在服务器上执行：

```bash
cd /你的仓库目录

./scripts/check-letsencrypt-dns.sh
```

也可以手动看解析和服务器公网 IP：

```bash
getent ahosts wanderlust0736.top
getent ahosts www.wanderlust0736.top
curl -4 https://api.ipify.org
```

如果域名没有解析到这台服务器公网 IP，先去 DNS 面板改：

- `wanderlust0736.top`：`A` 记录指向服务器公网 IP
- `www.wanderlust0736.top`：优先配 `CNAME` 到 `wanderlust0736.top`，或者单独配 `A` 记录到同一个公网 IP

改完后等 DNS 生效，再重新执行：

```bash
export CERTBOT_EMAIL=你的邮箱
./scripts/deploy-letsencrypt.sh
```

## 仓库里已有的相关文件

- `scripts/deploy-letsencrypt.sh`：首次签发和部署
- `scripts/renew-letsencrypt.sh`：续期命令
- `scripts/install-cert-renew-timer.sh`：一键安装并启用 systemd timer
- `deploy/systemd/wanderlust-cert-renew.service`：systemd service
- `deploy/systemd/wanderlust-cert-renew.timer`：systemd timer
- `deploy/cron/wanderlust-cert-renew.cron`：cron 配置
- `deploy/letsencrypt-drill.md`：完整实战演练清单