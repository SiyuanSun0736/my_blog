# 云服务器部署命令

这份文档面向刚刚 `git clone` 完仓库、准备首次上线 `wanderlust0736.top` 的场景。

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

./scripts/deploy-letsencrypt.sh
```

这组命令会做几件事：

- 拉取最新代码
- 给部署脚本执行权限
- 用 Let's Encrypt 为主域名和 `www` 申请证书
- 构建并启动 MongoDB、后端 API 和 Nginx 前端容器

## 上线后检查

```bash
cd /你的仓库目录

docker compose ps
docker logs inkharbor-web --since 10m
docker exec inkharbor-web wget -q --no-check-certificate -O - https://127.0.0.1/nginx-healthz
```

如果你还想确认 `www` 是否已经跳转到主域名，再执行：

```bash
cd /你的仓库目录

curl -k -I https://127.0.0.1 -H 'Host: www.wanderlust0736.top'
```

预期结果：

- `docker compose ps` 里 `inkharbor-web` 是 `healthy`
- `nginx-healthz` 返回的 `certificate` 路径是 `/etc/nginx/certs/live/wanderlust0736.top/fullchain.pem`
- `www.wanderlust0736.top` 返回 `301` 并跳到 `https://wanderlust0736.top/`

## 后续更新代码

以后服务已经跑起来之后，通常只需要这组命令：

```bash
cd /你的仓库目录

git pull
docker compose up -d --build
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

## 安装自动续期任务

推荐 `systemd timer`。

```bash
cd /你的仓库目录

sudo cp deploy/systemd/inkharbor-cert-renew.service /etc/systemd/system/
sudo cp deploy/systemd/inkharbor-cert-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now inkharbor-cert-renew.timer
sudo systemctl status inkharbor-cert-renew.timer
```

如果你更想用 `cron`，执行：

```bash
cd /你的仓库目录

crontab deploy/cron/inkharbor-cert-renew.cron
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

docker logs inkharbor-web --since 30m
```

查看后端日志：

```bash
cd /你的仓库目录

docker logs inkharbor-api --since 30m
```

查看 MongoDB 日志：

```bash
cd /你的仓库目录

docker logs inkharbor-mongodb --since 30m
```

## 失败时先看这几项

- DNS 是否已经解析到服务器公网 IP
- 服务器 `80/443` 端口是否对外开放
- `CERTBOT_EMAIL` 是否已设置
- 是否有其他服务占用了 `80` 或 `443`
- `docker logs inkharbor-web --since 10m` 里是否有证书校验或重载失败日志

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
- `deploy/systemd/inkharbor-cert-renew.service`：systemd service
- `deploy/systemd/inkharbor-cert-renew.timer`：systemd timer
- `deploy/cron/inkharbor-cert-renew.cron`：cron 配置
- `deploy/letsencrypt-drill.md`：完整实战演练清单