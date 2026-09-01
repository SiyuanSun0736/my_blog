# 部署时序

这份文档说明当前仓库里两条主要运行路径：

- 本地启动流程
- 线上更新流程

重点不是抽象原则，而是按当前脚本和 Compose 设计把完整执行顺序写清楚。

## 本地启动时序

本地开发默认通过 `scripts/up-local.sh` 启动整套栈。该脚本会读取根目录 `.env`，然后执行带 `--build` 的 Compose 启动。

### 时序图

![本地启动时序图](./assets/deployment-sequence-local.svg)

### 详细步骤

1. 开发者执行 `./scripts/up-local.sh`。
2. 脚本定位仓库根目录，并确认本地环境文件存在。
3. 脚本读取 `.env` 作为 Compose 环境。
4. 脚本执行 `docker compose --env-file "$compose_env_file" up -d --build mongodb redis blog-api blog-web`。
5. Compose 启动 `mongodb` 与 `redis`，并构建 `blog-api`、`blog-web` 镜像。
6. `blog-api` 启动后连接 MongoDB，并在可用时连接 Redis。
7. `blog-api` 在启动阶段还会完成 MongoDB 连通性检查和 `slug` 唯一索引检查。
8. `blog-web` 启动后加载 Nginx 配置、证书路径和前端构建产物。
10. 开发者通过本地域名或 `https://localhost:8444` 访问站点；宿主机 `443` 预留给前置 SNI router。

### 本地启动的特点

- 默认使用 `.env`
- 保留 Compose 默认并发，适合本机资源更宽松的场景
- 同时启动 MongoDB、Redis、API、Nginx 四个主要服务
- 如果只想看完整站点行为，优先走这条链路，而不是只开前端预览

## 线上更新时序

线上环境默认由 `GitHub Actions` 构建并推送镜像到 `GHCR`，然后由 `scripts/deploy-ghcr.sh` 在目标机执行 `docker compose pull` 和 `docker compose up --no-build`，目标机不承担 Node/Vite 或 Go 构建。

### 详细步骤

1. 开发者把代码推到 `main`，触发 `GitHub Actions`。
2. Actions 在云端按 `linux/amd64` 构建 `blog-api` 和 `blog-web` 镜像，并推送到 `GHCR`。
3. 运维在本机或自动化任务中执行 `./scripts/deploy-ghcr.sh`。
4. 脚本连接目标机，确认 `.env.deploy` 和 Compose 可用。
5. 如果没有显式跳过，脚本会在目标机调用 `scripts/backup-mongodb.sh`：

   - 从 `mongodb` 导出数据库归档
   - 从 `blog-api` 打包媒体目录
   - 把结果写到 `backups/mongodb/`，并同步到 `backups/latest-mongodb/`

6. 脚本在目标机登录 `GHCR`（如果配置了 `GHCR_USERNAME` 和 `GHCR_TOKEN`）。
7. 脚本执行 `docker compose --env-file .env.deploy pull mongodb redis blog-api blog-web`。
8. 脚本执行 `docker compose --env-file .env.deploy up -d --no-build --force-recreate mongodb redis blog-api blog-web`。
9. Compose 先拉起 MongoDB 和 Redis，并等待健康检查通过。
10. `blog-api` 在依赖健康后启动，连接 MongoDB 和 Redis。
11. `blog-web` 启动，接管 `80` 和宿主机 `127.0.0.1:8444`，并加载证书和前端静态资源；宿主机 `443` 留给前置 SNI router。
12. 脚本执行 `docker compose ps` 检查容器状态。
13. 脚本通过 `curl -k --resolve 主域名:8444:127.0.0.1 https://主域名:8444/api/posts` 验证 API 可用。
14. 脚本删除目标机运行目录里的源码，只保留运行必需文件和数据目录。
15. 如果指定了 `--logs`，脚本最后还会带出最近日志。

### 为什么线上流程要比本地更长

线上流程额外多了五类动作：

- Actions 构建并推送镜像
- 目标机从 GHCR 拉取镜像
- 备份
- 目标机最小运行包安装和源码清理
- 启动后健康验证

这是当前仓库针对低内存 VPS 的现实约束做出的运维设计，而不是单纯为了“流程完整”。

## 本地启动与线上更新的差异

| 维度 | 本地启动 | 线上更新 |
| --- | --- | --- |
| 环境文件 | `.env` | `.env.deploy` |
| 目标 | 开发验证 | 稳定发布 |
| 是否默认备份 | 否 | 是 |
| 是否在目标机构建 | 否 | 否 |
| 构建方式 | Compose 默认并发 | GitHub Actions 构建后推送 GHCR |
| 是否要求工作区干净 | 否 | 是 |
| 是否自动做 API 验证 | 通常不做 | 会做 |

## 推荐理解方式

如果只想记住一句话，可以这样理解当前部署设计：

- 本地启动追求的是方便和完整联调
- 线上更新追求的是低内存条件下的可控性和可回滚性，目标机只负责运行和加载镜像

这也是当前仓库为什么保留 `up-local.sh` 和 `deploy-ghcr.sh` 两条路径的原因。
