# 博客系统总架构设计

这份文档把 MongoDB、Redis、Nginx、Docker 以及跨洋全球双活（Cloudflare Anycast CDN + 日本/美国双节点）架构串联在一起，描述当前博客系统的整体运行拓扑与数据流动机制。

---

## 一、系统总架构拓扑

```mermaid
flowchart TD
    Client["🌍 全球访客 / 移动端读者"] --> CF["☁️ Cloudflare Anycast 全球边缘网络 (wanderlust0736.top)"]
    
    CF -->|亚太访客 / 就近路由| JP_SNI["🇯🇵 日本东京源站 (216.23.120.223:443)<br/>SNI Router (Nginx)"]
    CF -->|美洲/欧洲访客 / 容灾调度| US_SNI["🇺🇸 美国洛杉矶源站 (113.20.0.79:443)<br/>SNI Router (Nginx)"]

    subgraph Japan_Node["日本东京主节点 (vps2) - 读写全功能主站"]
        JP_SNI -->|Host: wanderlust0736.top| JP_Web["blog-web (Nginx 8444)"]
        JP_Web --> JP_API["blog-api (Go Gin 3001)"]
        JP_API --> JP_DB[("MongoDB 7 (WiredTiger 256MB)")]
        JP_API --> JP_Redis[("Redis 7 (LRU 64MB)")]
        JP_Web --> JP_Media[("共享媒体卷 (blog-media)")]
    end

    subgraph US_Node["美国洛杉矶节点 (cc) - 读热备 + 动态写转发"]
        US_SNI -->|Host: wanderlust0736.top| US_Web["blog-web (Nginx 8444)"]
        US_Web -->|GET 读请求| US_API["blog-api (Go Gin 3001)"]
        US_Web -->|POST/PUT/DELETE 写请求| JP_Web
        US_API --> US_DB[("MongoDB 7 (WiredTiger 256MB)")]
        US_API --> US_Redis[("Redis 7 (LRU 64MB)")]
        US_Web --> US_Media[("共享媒体卷 (blog-media)")]
    end

    JP_DB -.->|指纹比对增量同步 (sync-blog-jp-to-us.sh)| US_DB
    JP_Media -.->|rsync 增量同步| US_Media
```

---

## 二、核心层级设计与职责边界

### 1. 全球边缘与 TLS 加密层 (Cloudflare Anycast + Origin CA)
- **Anycast 边缘网络**：主域名 `wanderlust0736.top` 启用 Cloudflare CDN 代理（橙色云朵），将静态内容缓存在全球 300+ 边缘机房；
- **15 年 Origin CA 证书**：两台源站均安装 Cloudflare 官方颁发的 Origin 证书（有效期至 2041-09-25），并在 CDN 开启 **`Full (strict)`** 强加密，免去 90 天 ACME 续期负担；
- **多源站双活**：DNS 轮询配置日本东京 IPv4/IPv6 与美国洛杉矶 IPv4/IPv6 源站，实现全球访客就近接入与故障自动转移。

### 2. 宿主机 SNI 智能分流层 (`sni-router`)
宿主机 443 端口由四层 Nginx `sni-router` 统一监听（`ssl_preread on`）：
- 访问博客域名 `wanderlust0736.top` 时，透明转发给本地 `127.0.0.1:8444`（`blog-web`）；
- 伪装流量（SNI 为 `www.apple.com`）时，透明转发给本地 `127.0.0.1:8443`（Xray REALITY 代理）；
- 实现单端口、双业务在同一公网 IP 上的无缝复用。

### 3. Web 与动态读写分离层 (`blog-web` Nginx)
Nginx 在各源站负责终止 HTTPS 并执行动静分离：
- **静态 SPA 托管**：直接托管 React 产物，支持 `try_files $uri $uri/ /index.html`；
- **媒体文件分发**：直接读取 `blog-media` 卷，配置长效缓存头与 CSP 沙箱；
- **动态读写分离（美国备用节点独有）**：
  - `GET /api/`、`HEAD`、`OPTIONS`：由本地 `blog-api` 极速返回（0ms 跨洋延迟）；
  - `POST`、`PUT`、`DELETE`、`PATCH`：由 Nginx 自动反向代理至日本东京主站 `https://216.23.120.223:443` 处理，确保写入数据强一致性。

### 4. 业务核心与缓存层 (`blog-api` + MongoDB + Redis)
- **`blog-api` (Go Gin)**：
  - 业务逻辑处理、权限校验、Markdown 渲染、动态 Sitemap 及 PDF 导出；
  - 内存调优：锁定 `GOMEMLIMIT=120MiB` 与 `GOGC=50`，保证低配置 VPS 稳定性。
- **MongoDB 7**：
  - 业务事实来源（文章、标签、配置）；
  - 内存优化：限制 `wiredTigerCacheSizeGB=0.25`（256MB）。
- **Redis 7**：
  - 图片上传 SHA-256 去重索引与访问热点缓存；
  - 内存优化：限制 `maxmemory 64mb` 并配置 `allkeys-lru` 淘汰策略。

---

## 三、跨洋数据同步与前端高可用自愈

### 1. 自动化增量数据同步
- **触发机制**：日本主节点 Crontab 每天早晚定时运行（`0 7,19 * * *`）或发布后手动触发 [`scripts/sync-blog-jp-to-us.sh`](../scripts/sync-blog-jp-to-us.sh)；
- **指纹比对跳过**：脚本首先比对双端数据库的 SHA-256 指纹，若无内容变更则在 1 秒内安全退出，避免无谓传输；
- **流式同步**：变更时通过 SSH 隧道管道执行 `mongodump | mongorestore`，媒体文件通过 `rsync -avz --delete` 同步。

### 2. 前端弹性自愈设计
- **API 请求指数退避** (`frontend/src/lib/api.ts`)：
  - 针对网络波动或跨洋切流，GET 请求遭遇异常时自动执行最多 2 次指数退避重试（300ms、600ms）；
- **图片防裂二次加载** (`frontend/src/components/PostContent.tsx`)：
  - 遇到临时断裂图片时，自动附加防缓存时间戳发起二次静默重试，全面消除读者白屏体验。