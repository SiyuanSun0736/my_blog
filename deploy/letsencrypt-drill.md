# SSL 证书演练与管理说明

> [!NOTE]
> **架构升级说明 (2026-09-29)**：
> 当前生产环境已全面迁移至 **Cloudflare 15 年官方 Origin CA 证书**（有效期至 2041-09-25，支持 `wanderlust0736.top` 与 `*.wanderlust0736.top`），配合 Cloudflare Anycast CDN 开启 **`Full (strict)`** 强加密模式。
> 因此，以下基于 Certbot HTTP-01 验证的 90 天证书续期流程已作为**历史归档备选方案**，当前线上各节点由 Origin CA 证书长期平稳守护，无需再运行自动续期 cron / systemd timer。

---

## 历史归档：Let’s Encrypt 实战演练清单

1. 确认 DNS 已生效：`wanderlust0736.top` 的 `A` 记录和 `www.wanderlust0736.top` 的 `CNAME/A` 记录都指向当前服务器。
2. 确认 80 和 443 端口对外开放，防火墙和安全组没有拦截 HTTP-01 challenge。
3. 检查当前部署环境已经切到 Let’s Encrypt 目录约定：查看根目录下 `.env.deploy` 中的 `BLOG_TLS_CERTS_DIR`、`BLOG_TLS_CERT_PATH`、`BLOG_TLS_KEY_PATH`。
4. 首次签发证书：在运行目录下执行 `docker compose --profile certbot run --rm --service-ports certbot certonly --standalone --preferred-challenges http --agree-tos --no-eff-email --email "$CERTBOT_EMAIL" -d wanderlust0736.top -d www.wanderlust0736.top`，然后通过 `./scripts/deploy-ghcr.sh`（或 `docker compose --env-file .env.deploy up -d`）启动服务。
5. 查看容器状态：执行 `docker compose --env-file .env.deploy ps`，确认 `wanderlust-web` 为 `healthy`。
6. 检查主域名健康接口：执行 `docker exec wanderlust-web wget -q --no-check-certificate -O - https://127.0.0.1/nginx-healthz`，确认返回里的 `certificate` 路径为 `/etc/nginx/certs/live/wanderlust0736.top/fullchain.pem`。
7. 验证 `www` 跳转：执行 `curl -I https://wanderlust0736.top` 和 `curl -k --resolve www.wanderlust0736.top:8444:127.0.0.1 -I https://www.wanderlust0736.top:8444`，确认 `www` 返回 301 到主域名。
8. 做一次续期演练：执行 `CERTBOT_DRY_RUN=1 ./scripts/renew-letsencrypt.sh`，确认 Certbot dry-run 可以完成。
9. 查看重载日志：执行 `docker logs wanderlust-web --since 10m`，确认能看到 TLS watcher 的启动日志与证书指纹日志。
10. 安装自动续期任务：二选一。
    - 选择 `systemd`：在仓库根目录执行 `./scripts/install-cert-renew-timer.sh`，然后用 `sudo systemctl status wanderlust-cert-renew.timer` 确认定时器已启用。
    - 选择 `cron`：把 `deploy/cron/wanderlust-cert-renew.cron` 追加到 `crontab -e` 或 `/etc/cron.d/`。
11. 证书续期上线后复查：再次执行 `docker compose --env-file .env.deploy ps`、`docker logs wanderlust-web --since 10m`，确认没有 `nginx reload failed` 或 `Nginx config test failed` 日志。
