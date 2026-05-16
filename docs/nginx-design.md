# Nginx 设计

## 角色

Nginx 是系统的公网入口层，在当前架构里同时承担四项职责：

- TLS 终止
- 域名跳转与 HTTPS 强制化
- 前端构建产物静态托管
- 将部分动态路由反向代理到 `blog-api`

这样做的结果是：浏览器只面对一个统一入口，而后端 API 保持在容器内网端口上，不直接暴露给公网。

## 容器构建设计

`blog-web` 镜像来自 `nginx/Dockerfile`，采用多阶段构建：

1. 先在 Node.js 构建阶段安装前端依赖并执行 Vite 生产构建。
2. 再把生成的 `dist` 产物复制到最终的 `nginx:1.27-alpine` 镜像。
3. 同时把 Nginx 配置模板、证书校验脚本和自动重载脚本复制进去。

所以运行中的 `blog-web` 容器既是静态文件服务器，也是反向代理层。

## 域名与 TLS 设计

当前 Nginx 配置区分主域名和 `www` 域名。

现有域名行为如下：

- `www` 的 HTTP 请求会被重定向到主域名 HTTPS
- 主域名的 HTTP 请求会被重定向到同主机的 HTTPS
- `www` 的 HTTPS 请求会被重定向到主域名 HTTPS
- 主域名 HTTPS 才是真正提供站点内容的入口

证书路径通过环境变量注入：

- `TLS_CERT_PATH`
- `TLS_KEY_PATH`

容器启动时会先校验证书文件是否存在；如果开启自动重载，容器会轮询挂载进来的证书文件变化，并在续期后执行 `nginx -s reload`。

## 路由设计

Nginx 通过路径级路由把静态内容和动态请求分流。

### 前端静态资源

前端构建产物位于 `/usr/share/nginx/html`。为了兼容 SPA 刷新场景，默认路由使用：

- `try_files $uri $uri/ /index.html`

这保证浏览器直接访问前端路由时，仍然能回到前端入口页继续由客户端路由接管。

### 反向代理路由

以下路径会被转发到 `blog-api`：

- `/api/`：主 API 入口
- `/healthz`：后端健康检查
- `/sitemap.xml`：动态生成的站点地图
- `/robots.txt`：动态生成的 robots 规则
- `/posts/:slug/pdf`：公开 PDF 下载地址，转译到后端 `/api/posts/:slug/pdf`

转发时会携带标准上游请求头，包括 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`。

### 媒体文件分发

生产流量下，上传后的文件不是由 Go 后端直接对外返回，而是由 Nginx 直接暴露共享媒体卷到 `/media/`。

当前媒体分发行为包括：

- 使用 `alias /usr/share/nginx/media/`
- 为不可变媒体提供长缓存头
- 添加 `X-Content-Type-Options: nosniff`
- 对 SVG 额外附加 CSP sandbox 头

这样做可以把媒体文件请求从 API 容器剥离出来，降低后端无谓负载。

### ACME 校验路径

`/.well-known/acme-challenge/` 会从 `/var/www/certbot` 提供内容，用于 Certbot 完成 HTTP-01 校验。

## 运行参数设计

当前站点级参数主要包括：

- `client_max_body_size 8m`：与后端图片上传上限对齐
- gzip 压缩：覆盖常见文本响应和 SVG
- `/nginx-healthz`：供容器健康检查使用的显式入口

这里最关键的是代理层限制和后端契约保持一致。如果 Nginx 的上传上限比后端更小，请求会在还没到 API 之前就被拦下。

## 卷挂载设计

`blog-web` 容器当前会挂载三类外部数据：

- 证书目录，只读
- Certbot webroot 目录，只读
- 共享媒体卷，只读

这是刻意设计出来的职责分离。只有 `blog-api` 能写媒体文件，Nginx 只负责读取和对外服务。

## 设计取舍

当前方案的优点：

- 浏览器、API、媒体、TLS 都统一收口在一个公网入口
- 静态资源和媒体文件的分发效率高于全部经过 Go 后端
- 域名规范化逻辑集中在 Nginx，而不是散落在应用代码里

当前方案的边界：

- Nginx 同时承载前端构建产物和反向代理，所以前端发布仍然需要重建该镜像
- 路由规则集中在一份配置文件里，当前简单，但后续子系统继续增加时维护复杂度会上升

对目前这个单站点架构来说，这是一个偏务实的平衡点：实现简单，但已经具备可部署性。