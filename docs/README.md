# 系统设计文档

这个目录用于记录当前博客系统的核心基础设施设计，内容以仓库里已经落地的实现为准，不写脱离代码的抽象目标方案。

- [MongoDB 设计](./mongodb-design.md)：主业务数据模型、索引与持久化策略
- [Redis 设计](./redis-design.md)：图片上传去重索引与降级策略
- [Nginx 设计](./nginx-design.md)：公网入口、TLS、路由转发与静态资源分发
- [Docker 设计](./docker-design.md)：容器拓扑、镜像构建与部署流程
- [总架构图](./architecture-overview.md)：把 MongoDB、Redis、Nginx、Docker 串成一张系统图
- [部署时序](./deployment-sequence.md)：本地启动与线上更新的完整执行流程