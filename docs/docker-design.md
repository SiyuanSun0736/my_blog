# Docker 设计

## 角色

Docker 是系统的打包边界和运行边界，Docker Compose 负责把所有服务编排成一套可启动、可部署的栈，同时尽量保持本地开发和线上部署的结构一致。

当前 Compose 拓扑包含 5 个服务：

- `mongodb`：主数据库
- `redis`：图片上传去重索引
- `blog-api`：Go 后端
- `blog-web`：Nginx 与前端静态资源容器
- `certbot`：可选证书管理服务，挂在 `certbot` profile 下

## 容器拓扑

整个系统是分层的，流量和数据关系比较清晰。

主要链路如下：

1. 浏览器流量从 `80` 和 `443` 进入 `blog-web`。
2. Nginx 直接服务前端静态资源。
3. Nginx 将 API 和文档导出相关路由转发到 `8080` 端口上的 `blog-api`。
4. `blog-api` 读写 MongoDB 中的主业务数据。
5. `blog-api` 在 Redis 可用时读写图片摘要映射。
6. 上传媒体由 `blog-api` 写入共享卷，再由 `blog-web` 只读挂载并对外提供。

这种拆分方式把公网入口层和状态型服务分开了，职责边界比较明确。

## 镜像构建设计

### blog-api 镜像

后端镜像使用多阶段构建：

1. 基于 `golang:1.23-alpine` 的构建阶段
2. 下载 Go modules 以及 PDF 数学渲染需要的 npm 依赖
3. 使用低内存构建参数编译 Go 二进制
4. 把二进制和 PDF 渲染资产复制到较小的 Alpine 运行时镜像

运行时镜像中额外包含 Chromium、Node.js 和字体，因为 PDF 导出需要渲染 LaTeX、表格和 SVG 片段。

### blog-web 镜像

前端 Web 镜像同样采用多阶段构建：

1. 在 Node.js 阶段构建前端产物
2. 把 `dist` 复制到 `nginx:1.27-alpine`
3. 加入 Nginx 配置模板和证书相关辅助脚本

所以前端构建产物最终是以镜像内容的形式固化下来的。

## 依赖与启动设计

Compose 中显式声明了启动依赖：

- `blog-api` 依赖健康的 `mongodb` 和健康的 `redis`
- `blog-web` 依赖 `blog-api`

健康检查也是设计的一部分，而不是事后补上去的：

- MongoDB：通过 `mongosh` 执行 `ping`
- Redis：通过 `redis-cli ping`
- Nginx：通过 HTTPS 请求 `/nginx-healthz`

这样 Compose 区分的是“服务可用”而不只是“进程已启动”。

## 持久化设计

当前栈通过命名卷承载所有需要长期保存的运行时状态：

- `mongodb-data`：MongoDB 数据文件
- `redis-data`：Redis AOF 和快照数据
- `blog-media`：上传后的图片文件

核心目标很明确：容器重建不能破坏业务数据。

## 环境拆分

仓库通过环境文件区分本地与部署默认值。

当前约定如下：

- `.env`：本地开发默认配置，使用 `localhost`、本地证书、更宽松的内存参数
- `.env.deploy.example`：线上部署模板，包含公网域名和低内存 VPS 默认参数
- `.env.deploy`：实际部署文件，由模板复制而来，且不提交进 git

这样做的原因是：同一套 Compose 拓扑要在两个资源条件明显不同的环境里运行。

## 低内存部署策略

当前仓库已经把低内存优化直接写进 Docker 化部署里了。

主要做法包括：

- 通过 `MONGODB_WIREDTIGER_CACHE_GB` 压低 MongoDB cache
- 通过 `GOMEMLIMIT` 和 `GOGC` 控制 Go 运行时内存
- 通过构建参数限制 Go 编译内存与并发度
- 通过 `FRONTEND_BUILD_MAX_OLD_SPACE_SIZE` 限制前端构建时 Node heap
- 部署脚本串行构建 `blog-api` 和 `blog-web`，而不是依赖并行的 `up --build`

这套策略就是为当前 `1CPU/1GB` 的 VPS 目标环境准备的。

## 运行流程

仓库里当前主要有两种 Docker 工作流。

### 本地启动

`scripts/up-local.sh` 会读取本地环境文件并启动整套服务，保留 Compose 默认并发能力，更适合本机开发。

### 线上更新

`scripts/update-deploy.sh` 会执行一套偏生产化的流程：

1. 按需备份 MongoDB 和媒体文件
2. 停掉当前运行中的应用容器
3. 以非交互方式拉取最新代码
4. 单独构建 `blog-api`
5. 单独构建 `blog-web`
6. 启动 `mongodb`、`redis`、`blog-api`、`blog-web`
7. 校验容器状态和 API 可达性

相比直接在小机器上执行一次 `docker compose up --build`，这套流程更稳，因为它避免了不可控的并行构建内存峰值。

## 设计取舍

当前方案的优点：

- 本地和线上环境在结构上保持一致
- 数据独立于容器生命周期存在
- 容器之间的职责边界清晰
- 部署脚本沉淀了运维步骤，而不是依赖人工记忆

当前方案的边界：

- 仍然是单机 Compose，不是编排集群
- 服务发现依赖 Compose 默认网络，不是更复杂的平台层
- 前端和 Nginx 仍耦合在同一个最终镜像里

对当前仓库的规模和部署方式来说，Docker Compose 的抽象层级是合适的：不复杂，但足够可控。