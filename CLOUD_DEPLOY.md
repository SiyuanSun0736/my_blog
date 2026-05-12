# 云服务器部署命令

这份文档面向刚刚 `git clone` 完仓库、准备首次上线 `wanderlust0736.top` 的场景。

## 当前环境记录

- 当前这台服务器只用于开发验证，不作为正式生产环境。
- 当前开发部署主机公网 IP：`47.79.86.69`
- 当前仓库在这台机器上的更新，默认按“先备份数据库，再更新代码，再重建网页和 API，最后验证”的顺序执行。

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
chmod +x scripts/deploy-letsencrypt.sh scripts/renew-letsencrypt.sh

export CERTBOT_EMAIL=你的邮箱
export BLOG_WRITE_TOKEN=替换成一个长随机字符串

./scripts/deploy-letsencrypt.sh
```

这组命令会做几件事：

- 拉取最新代码
- 给部署脚本执行权限
- 用 Let's Encrypt 为主域名和 `www` 申请证书
- 构建并启动 MongoDB、后端 API 和 Nginx 前端容器
- 创建并挂载 MongoDB 数据卷，避免容器重建时丢数据

如果你准备直接公开 `/write`，记得在首次启动前就把 `BLOG_WRITE_TOKEN` 设好；否则写作入口会因为服务端未配置令牌而拒绝发布。

## 上线后检查

```bash
cd /你的仓库目录

docker compose ps
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

## git pull 后更新数据库和网页

当前项目已经把 MongoDB 数据放进命名卷 `mongodb-data`，所以日常 `git pull` 更新时，不需要先删库，也不需要重建 Mongo 容器。默认推荐下面这套顺序：

```bash
cd /你的仓库目录

./scripts/backup-mongodb.sh
git pull --ff-only
docker compose up -d --build blog-api blog-web
docker compose ps
curl -sk https://127.0.0.1/api/posts -H 'Host: wanderlust0736.top'
docker logs wanderlust-api --since 10m
docker logs wanderlust-web --since 10m
```

这组命令分别处理的事情是：

- 先备份当前数据库，给回滚留出口
- 拉取最新代码，避免 merge commit 混进服务器更新流程
- 只重建 `blog-api` 和 `blog-web`，保留当前 MongoDB 数据卷
- 用 `docker compose ps`、文章列表接口和最近日志确认网页与 API 都已切到新版本

### 日常更新原则

- 只改前端、后端接口、页面样式、Nginx 配置时：重建 `blog-api` 和 `blog-web` 就够了。
- 当前版本没有独立 migration 系统，所以 `git pull` 后不会自动重写 MongoDB 里的内容。
- 只要你不主动重建或删除 `mongodb-data` 卷，数据库内容会继续保留。

### 如果本次改动涉及数据库结构

如果某次更新明确涉及 MongoDB 结构、数据修正、字段回填或清洗，推荐改用下面这套更稳的流程：

```bash
cd /你的仓库目录

./scripts/backup-mongodb.sh
git pull --ff-only
docker compose up -d --build blog-api blog-web

# 按本次改动需要执行数据库脚本或手动修正
# 例如：docker compose exec -T mongodb mongosh

docker compose ps
curl -sk https://127.0.0.1/api/posts -H 'Host: wanderlust0736.top'
docker logs wanderlust-api --since 10m
```

如果更新后发现数据不对，优先回到最近一次备份：

```bash
cd /你的仓库目录

./scripts/restore-mongodb.sh ./backups/mongodb/最近一次备份目录
docker compose up -d blog-api blog-web
```

### 什么时候才需要重建 MongoDB 容器

只有下面这些场景，才建议把 `mongodb` 也纳入重建范围：

- `docker-compose.yml` 里 Mongo 镜像版本发生变化
- 你需要验证新的 Mongo 配置是否生效
- Mongo 容器本身异常，且仅重启不能恢复

对应命令：

```bash
cd /你的仓库目录

./scripts/backup-mongodb.sh
git pull --ff-only
docker compose up -d --build mongodb blog-api blog-web
docker compose ps
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

默认备份会输出到 `backups/mongodb/<database>-<timestamp>/dump.archive.gz`。

恢复示例：

```bash
cd /你的仓库目录

./scripts/restore-mongodb.sh ./backups/mongodb/你的备份目录
```

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

sudo cp deploy/systemd/wanderlust-cert-renew.service /etc/systemd/system/
sudo cp deploy/systemd/wanderlust-cert-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wanderlust-cert-renew.timer
sudo systemctl status wanderlust-cert-renew.timer
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
- `deploy/systemd/wanderlust-cert-renew.service`：systemd service
- `deploy/systemd/wanderlust-cert-renew.timer`：systemd timer
- `deploy/cron/wanderlust-cert-renew.cron`：cron 配置
- `deploy/letsencrypt-drill.md`：完整实战演练清单