# 部署时序

这份文档说明当前仓库里两条主要运行路径：

- 本地启动流程
- 线上更新流程

重点不是抽象原则，而是按当前脚本和 Compose 设计把完整执行顺序写清楚。

## 本地启动时序

本地开发默认通过 `scripts/up-local.sh` 启动整套栈。该脚本会读取根目录 `.env`，然后执行带 `--build` 的 Compose 启动。

### 时序图

```mermaid
sequenceDiagram
    participant Dev as 开发者
    participant Script as scripts/up-local.sh
    participant Compose as docker compose
    participant Mongo as mongodb
    participant Redis as redis
    participant API as blog-api
    participant Web as blog-web(Nginx)

    Dev->>Script: 执行本地启动脚本
    Script->>Script: 定位仓库根目录
    Script->>Script: 读取 .env
    Script->>Compose: up -d --build mongodb redis blog-api blog-web
    Compose->>Mongo: 构建/启动服务
    Compose->>Redis: 启动服务
    Compose->>API: 构建后端镜像并启动
    Compose->>Web: 构建前端+Nginx 镜像并启动
    API->>Mongo: 建立数据库连接并 ping
    API->>Redis: 建立 Redis 连接并 ping
    Web->>API: 反向代理准备完成
    Dev->>Web: 通过 localhost 访问站点
```

### 详细步骤

1. 开发者执行 `./scripts/up-local.sh`。
2. 脚本定位仓库根目录，并确认本地环境文件存在。
3. 脚本读取 `.env` 作为 Compose 环境。
4. 脚本执行 `docker compose --env-file "$compose_env_file" up -d --build mongodb redis blog-api blog-web`。
5. Compose 启动 `mongodb` 与 `redis`，并构建 `blog-api`、`blog-web` 镜像。
6. `blog-api` 启动后连接 MongoDB，并在可用时连接 Redis。
7. `blog-api` 在启动阶段还会完成 MongoDB 连通性检查和 `slug` 唯一索引检查。
8. `blog-web` 启动后加载 Nginx 配置、证书路径和前端构建产物。
9. 开发者通过本地域名或本地证书入口访问站点。

### 本地启动的特点

- 默认使用 `.env`
- 保留 Compose 默认并发，适合本机资源更宽松的场景
- 同时启动 MongoDB、Redis、API、Nginx 四个主要服务
- 如果只想看完整站点行为，优先走这条链路，而不是只开前端预览

## 线上更新时序

线上环境默认通过 `scripts/update-deploy.sh` 进行更新。这个脚本不是简单的 `up --build` 包装，而是把低内存 VPS 的部署顺序固定下来。

### 时序图

```mermaid
sequenceDiagram
    participant Ops as 运维/开发者
    participant Script as scripts/update-deploy.sh
    participant Git as Git 远端
    participant Compose as docker compose
    participant Backup as backup-mongodb.sh
    participant Mongo as mongodb
    participant Redis as redis
    participant API as blog-api
    participant Web as blog-web(Nginx)
    participant Client as 本机验证请求

    Ops->>Script: 执行更新脚本
    Script->>Script: 读取 .env.deploy
    Script->>Script: 校验 docker / curl / compose 可用
    Script->>Script: 检查 tracked worktree 是否干净
    Script->>Backup: 执行备份脚本
    Backup->>Mongo: 导出数据库 archive
    Backup->>API: 打包媒体目录
    Script->>Compose: stop blog-web blog-api redis mongodb
    Script->>Git: git pull --ff-only 或 force-sync
    Script->>Compose: build blog-api
    Script->>Compose: build blog-web
    Script->>Compose: up -d mongodb redis blog-api blog-web
    Compose->>Mongo: 启动并通过健康检查
    Compose->>Redis: 启动并通过健康检查
    Compose->>API: 等待 Mongo/Redis 健康后启动
    Compose->>Web: 启动 Nginx
    Script->>Compose: ps 检查状态
    Script->>Client: curl https://127.0.0.1/api/posts
    Client-->>Script: API 可用
```

### 详细步骤

1. 运维执行 `./scripts/update-deploy.sh`。
2. 脚本确认 `docker`、`curl` 和 Compose 能正常使用。
3. 如果没有显式跳过，脚本会先检查当前 tracked 文件是否干净，避免把线上更新做成半人工 merge 现场。
4. 如果没有显式跳过备份，脚本会调用 `scripts/backup-mongodb.sh`：

   - 从 `mongodb` 导出数据库归档
   - 从 `blog-api` 打包媒体目录
   - 把结果写到 `backups/mongodb/`，并同步到 `backups/latest-mongodb/`

5. 脚本停止 `blog-web`、`blog-api`、`redis`、`mongodb`，避免构建阶段继续占用运行时内存。
6. 脚本执行非交互式 `git pull --ff-only`；如果开启强制同步，则按脚本逻辑做 force sync。
7. 脚本先单独构建 `blog-api` 镜像。
8. 脚本再单独构建 `blog-web` 镜像。
9. 脚本执行 `docker compose --env-file .env.deploy up -d mongodb redis blog-api blog-web`。
10. Compose 先拉起 MongoDB 和 Redis，并等待健康检查通过。
11. `blog-api` 在依赖健康后启动，连接 MongoDB 和 Redis。
12. `blog-web` 启动，接管 80/443，并加载证书和前端静态资源。
13. 脚本执行 `docker compose ps` 检查容器状态。
14. 脚本通过 `curl -k https://127.0.0.1/api/posts -H 'Host: 主域名'` 验证 API 可用。
15. 如果指定了 `--logs`，脚本最后还会带出最近日志。

### 为什么线上流程要比本地更长

线上流程额外多了四类动作：

- 备份
- 停服务释放内存
- 非交互拉取代码
- 启动后健康验证

这是当前仓库针对低内存 VPS 的现实约束做出的运维设计，而不是单纯为了“流程完整”。

## 本地启动与线上更新的差异

| 维度 | 本地启动 | 线上更新 |
| --- | --- | --- |
| 环境文件 | `.env` | `.env.deploy` |
| 目标 | 开发验证 | 稳定发布 |
| 是否默认备份 | 否 | 是 |
| 是否停机后再构建 | 否 | 是 |
| 构建方式 | Compose 默认并发 | 串行构建 `blog-api`、`blog-web` |
| 是否要求工作区干净 | 否 | 是 |
| 是否自动做 API 验证 | 通常不做 | 会做 |

## 推荐理解方式

如果只想记住一句话，可以这样理解当前部署设计：

- 本地启动追求的是方便和完整联调
- 线上更新追求的是低内存条件下的可控性和可回滚性

这也是当前仓库为什么同时保留 `up-local.sh` 和 `update-deploy.sh` 两条路径的原因。