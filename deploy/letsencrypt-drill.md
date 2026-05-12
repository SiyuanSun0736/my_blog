# Let’s Encrypt 实战演练清单

1. 确认 DNS 已生效：`wanderlust0736.top` 的 `A` 记录和 `www.wanderlust0736.top` 的 `CNAME/A` 记录都指向当前服务器。
2. 确认 80 和 443 端口对外开放，防火墙和安全组没有拦截 HTTP-01 challenge。
3. 检查当前 Compose 默认环境已经切到 Let’s Encrypt 目录约定：查看根目录下 `.env` 中的 `BLOG_TLS_CERTS_DIR`、`BLOG_TLS_CERT_PATH`、`BLOG_TLS_KEY_PATH`。
4. 首次签发前准备邮箱：`export CERTBOT_EMAIL=you@example.com`。
5. 首次签发并启动服务：在仓库根目录执行 `./scripts/deploy-letsencrypt.sh`。
6. 查看容器状态：执行 `docker compose ps`，确认 `wanderlust-web` 为 `healthy`。
7. 检查主域名健康接口：执行 `docker exec wanderlust-web wget -q --no-check-certificate -O - https://127.0.0.1/nginx-healthz`，确认返回里的 `certificate` 路径为 `/etc/nginx/certs/live/wanderlust0736.top/fullchain.pem`。
8. 验证 `www` 跳转：执行 `curl -I https://wanderlust0736.top` 和 `curl -k -I https://127.0.0.1 -H 'Host: www.wanderlust0736.top'`，确认 `www` 返回 301 到主域名。
9. 做一次续期演练：执行 `CERTBOT_DRY_RUN=1 ./scripts/renew-letsencrypt.sh`，确认 Certbot dry-run 可以完成。
10. 查看重载日志：执行 `docker logs wanderlust-web --since 10m`，确认能看到 TLS watcher 的启动日志与证书指纹日志。
11. 安装自动续期任务：二选一。
12. 选择 `systemd`：复制 `deploy/systemd/wanderlust-cert-renew.service` 和 `deploy/systemd/wanderlust-cert-renew.timer` 到 `/etc/systemd/system/`，然后执行 `sudo systemctl daemon-reload && sudo systemctl enable --now wanderlust-cert-renew.timer`。
13. 选择 `cron`：把 `deploy/cron/wanderlust-cert-renew.cron` 追加到 `crontab -e` 或 `/etc/cron.d/`。
14. 证书续期上线后复查：再次执行 `docker compose ps`、`docker logs wanderlust-web --since 10m`，确认没有 `nginx reload failed` 或 `Nginx config test failed` 日志。
