# 本地查看构建效果

这份说明只解决一件事：在本地把 WanderlustBlog 跑起来，并看到页面效果。

当前仓库已经拆成两套 Compose 环境：

- 根目录 `.env` 是本地测试默认配置，允许更高并发，适合本机直接 `docker compose`。
- 根目录 `.env.deploy` 是部署配置，专门给 `1CPU/1GB` VPS 用，相关部署脚本会显式读取它。

当前仓库有 3 种常见用法：

1. 日常改页面时看效果：前端 Vite 开发模式 + 本地后端。
2. 想看更接近线上部署的完整效果：Docker Compose 启动 MongoDB、Redis、API、Nginx。
3. 只想确认前端能不能成功打包：只跑 `npm run build`。

## 先说结论

- 你如果正在改首页样式、文案、布局，优先用“方案 A”。
- 你如果想看真正的“本地构建后显示效果”，优先用“方案 B”。
- 你如果只跑 `frontend/npm run preview`，当前仓库里**不能**完整看到数据页效果，因为它不会像开发模式那样自动代理 `/api` 和 `/media`。

## 前置条件

- Node.js 20+
- Go 1.23+
- Docker + Docker Compose（如果你走方案 B）
- 本机可用的 MongoDB，或者直接用 `docker compose up -d mongodb redis`

仓库根目录默认是：

```bash
cd /home/ssy/web
```

## 方案 A：本地开发模式看页面效果

这是最适合平时改 UI 的方式。

### 1. 启动 MongoDB

如果你本机已经有 MongoDB，可以跳过这一步。

如果没有，直接用仓库自带 Compose 起一个数据库；如果你也想本地验证图片上传去重，顺手把 Redis 一起起起来：

```bash
cd /home/ssy/web
docker compose up -d mongodb redis
```

### 2. 启动后端 API

如果你只是想浏览首页、归档、文章详情，可以不配写作令牌。

如果你还想打开管理端发布测试文章或上传测试图片，需要同时配置 `BLOG_WRITE_TOKEN`。如果上一步已经启动 Redis，也可以顺手把 `REDIS_ADDR` 指到本机。

```bash
cd /home/ssy/web/backend
export MONGODB_URI=mongodb://localhost:27017
export MONGODB_DATABASE=wanderlust
export BLOG_WRITE_TOKEN=dev-token
export REDIS_ADDR=localhost:6379
go run .
```

后端默认监听：

```text
http://localhost:8080
```

本地上传图片默认会写到 `backend/uploads/`，并由后端直接通过 `http://localhost:8080/media/...` 提供访问；前端开发服务器也会把 `/media` 代理到这个地址。

### 3. 启动前端开发服务器

```bash
cd /home/ssy/web/frontend
npm install
npm run dev
```

前端默认地址：

```text
http://localhost:5173
```

### 4. 打开页面

直接访问：

- 首页：`http://localhost:5173/`
- 归档：`http://localhost:5173/archive`
- 管理端：`http://localhost:5173/admin`

旧的 `http://localhost:5173/write` 现在会自动跳转到 `/admin`，但公开页面不会再展示这个入口。

### 5. 这个模式为什么最适合改样式

- 支持热更新
- 前端开发服务器会自动把 `/api` 和 `/media` 代理到 `http://localhost:8080`
- 不需要处理 HTTPS 和本地证书问题

## 方案 B：本地看“构建后”的完整显示效果

这是最接近线上形态的本地预览方式。

当前仓库里，Nginx 会同时负责：

- 提供前端构建产物
- 代理 `/api`
- 服务 `/media`
- 走 HTTPS

所以如果你想看真正的“build 后完整页面”，不要只跑 `npm run preview`，而是直接走 Compose。

### 1. 在仓库根目录构建镜像

```bash
cd /home/ssy/web
./scripts/up-local.sh
```

这条脚本会直接按本地 `.env` 启动 `mongodb`、`redis`、`blog-api` 和 `blog-web`，并保留 Compose 默认并发；如果你只想手动执行，也可以继续使用普通 `docker compose up -d --build mongodb redis blog-api blog-web`。

### 2. 启动完整服务

如果上一步已经执行 `./scripts/up-local.sh`，这里可以直接跳过。

### 3. 打开页面

访问：

```text
https://localhost
```

也可以检查健康接口：

```text
https://localhost/nginx-healthz
```

### 4. 浏览器提示证书不安全怎么办

这是本地 HTTPS 预览时最常见的情况。

当前仓库会从下面两个文件读取证书：

- `certs/fullchain.pem`
- `certs/privkey.pem`

如果浏览器提示不安全，通常是本地证书不被系统信任，或者证书没有覆盖 `localhost`。这不影响你本地看页面结构和样式。

如果只是临时验页面，直接继续访问即可。

如果你希望本地 `https://localhost` 完全不报警，需要自己换成包含 `localhost` 的本地证书。

## 方案 C：只验证前端能不能打包

如果你只是想确认这次改动有没有把前端打坏，只需要：

```bash
cd /home/ssy/web/frontend
npm run build
```

构建产物会输出到：

```text
/home/ssy/web/frontend/dist
```

### 关于 `npm run preview`

当前仓库里：

```bash
cd /home/ssy/web/frontend
npm run preview
```

只适合看静态打包是否能启动，**不适合**当成完整页面预览方式，原因是：

- `preview` 只是静态文件服务
- 它不会像 `npm run dev` 那样代理 `/api` 和 `/media`
- 当前后端没有为 `http://localhost:4173` 单独配置跨域

所以文章列表、文章详情、管理端这类依赖 API 的页面，在 `preview` 模式下通常会请求失败

## 为什么页面可能是空的

当前仓库没有内置 seed 数据。

这意味着：

- 如果 MongoDB 里没有文章，首页列表会是空状态
- 这不是前端坏了，而是数据库里本来就没有内容

你可以用两种方式准备数据：

### 方式 1：去管理端写一篇测试文章

先按方案 A 启动后端时配置：

```bash
export BLOG_WRITE_TOKEN=dev-token
```

然后打开：

```text
http://localhost:5173/admin
```

先验证令牌，再发一篇测试文章。

### 方式 2：恢复已有备份

仓库已经带了备份脚本和备份目录。如果你想直接看到更完整的博客内容，可以恢复 MongoDB 备份。

示例：

```bash
cd /home/ssy/web
./scripts/restore-mongodb.sh ./backups/mongodb/你的备份目录
```

## 推荐操作顺序

如果你现在主要是看我刚改的首页效果，建议直接按下面做：

```bash
cd /home/ssy/web
docker compose up -d mongodb redis

cd backend
export MONGODB_URI=mongodb://localhost:27017
export MONGODB_DATABASE=wanderlust
export BLOG_WRITE_TOKEN=dev-token
export REDIS_ADDR=localhost:6379
go run .

cd ../frontend
npm run dev
```

然后打开：

```text
http://localhost:5173
```

如果你想看“真正 build 后”的本地效果，再执行：

```bash
cd /home/ssy/web
./scripts/up-local.sh
```

然后打开：

```text
https://localhost
```

## 常见问题

### 1. 首页提示无法加载文章列表

通常是下面几种情况：

- 后端没启动
- MongoDB 没启动
- 你开的是 `npm run preview`，不是 `npm run dev`

### 2. 管理端验证失败

通常是因为后端没有配置：

```bash
export BLOG_WRITE_TOKEN=dev-token
```

### 3. Docker 起了但浏览器报 HTTPS 风险

这是本地证书问题，不是前端构建问题。临时看效果可以继续访问。

### 4. 页面能打开，但没有文章

这是因为当前数据库里没有数据。去 `/admin` 发一篇，或者恢复备份即可。
