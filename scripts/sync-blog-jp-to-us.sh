#!/bin/bash
set -euo pipefail

# ==============================================================================
# 博客跨洋双活增量同步脚本 (日本东京节点 -> 美国洛杉矶节点)
# 用于将 vps2 主写入节点的 MongoDB 文章数据和媒体上传文件同步到 cc 节点
# ==============================================================================

DEST_HOST="${DEST_HOST:-113.20.0.79}"
DEST_PORT="${DEST_PORT:-2225}"
DEST_USER="${DEST_USER:-root}"

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] 开始同步博客数据至美国节点 (${DEST_HOST}:${DEST_PORT})..."

# 1. 同步 MongoDB 数据库
echo "--> [1/2] 备份并流式恢复 MongoDB 数据库 (wanderlust)..."
docker exec wanderlust-mongodb mongodump --db wanderlust --archive --gzip | \
  ssh -p "${DEST_PORT}" -o StrictHostKeyChecking=no "${DEST_USER}@${DEST_HOST}" \
  "docker exec -i wanderlust-mongodb mongorestore --nsInclude='wanderlust.*' --archive --gzip --drop"

# 2. 增量同步媒体资源目录
echo "--> [2/2] 同步媒体与配图资源目录 (/app/media)..."
rsync -avz --delete -e "ssh -p ${DEST_PORT} -o StrictHostKeyChecking=no" \
  /var/lib/docker/volumes/my_blog_blog-media/_data/ \
  "${DEST_USER}@${DEST_HOST}:/var/lib/docker/volumes/my_blog_blog-media/_data/"

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] ✅ 博客双活数据同步成功完成！"
