#!/bin/bash
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# ==============================================================================
# 博客跨洋双活智能增量同步脚本 (日本东京节点 -> 美国洛杉矶节点)
# 特性：仅在检测到文章数据或媒体资源发生变动时才触发同步；无变动时秒级跳过
# ==============================================================================

DEST_HOST="${DEST_HOST:-113.20.0.79}"
DEST_PORT="${DEST_PORT:-2225}"
DEST_USER="${DEST_USER:-root}"
STATE_FILE="${STATE_FILE:-/opt/my_blog/.sync_fingerprint}"
MEDIA_DIR="/var/lib/docker/volumes/my_blog_blog-media/_data"

# 支持强制同步参数: --force 或 -f
FORCE_SYNC=0
if [[ "${1:-}" == "--force" || "${1:-}" == "-f" ]]; then
    FORCE_SYNC=1
fi

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] 正在检查日本站数据变更状态..."

# 1. 计算当前 MongoDB 文章数据指纹 (涵盖所有文章内容、标题、发布时间与排序)
CURRENT_DB_HASH=$(docker exec wanderlust-mongodb mongosh --quiet mongodb://localhost:27017/wanderlust \
  --eval 'EJSON.stringify(db.posts.find().sort({_id:1}).toArray())' | md5sum | awk '{print $1}')

# 2. 计算当前媒体图片目录指纹 (文件列表、大小、修改时间)
CURRENT_MEDIA_HASH=""
if [ -d "$MEDIA_DIR" ]; then
    CURRENT_MEDIA_HASH=$(find "$MEDIA_DIR" -type f | sort | xargs stat -c '%n %s %Y' 2>/dev/null | md5sum | awk '{print $1}')
fi

# 3. 读取上一次同步成功的指纹
LAST_DB_HASH=""
LAST_MEDIA_HASH=""
if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE" || true
fi

# 4. 判断是否有变更
DB_CHANGED=0
MEDIA_CHANGED=0

if [ "$FORCE_SYNC" -eq 1 ] || [ -z "$LAST_DB_HASH" ] || [ "$CURRENT_DB_HASH" != "$LAST_DB_HASH" ]; then
    DB_CHANGED=1
fi

if [ "$FORCE_SYNC" -eq 1 ] || [ -z "$LAST_MEDIA_HASH" ] || [ "$CURRENT_MEDIA_HASH" != "$LAST_MEDIA_HASH" ]; then
    MEDIA_CHANGED=1
fi

if [ "$DB_CHANGED" -eq 0 ] && [ "$MEDIA_CHANGED" -eq 0 ]; then
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] ✨ MongoDB 与媒体文件均无变更，无需同步 (已跳过)。"
    exit 0
fi

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] 发现数据变更 (DB: $DB_CHANGED, Media: $MEDIA_CHANGED)，开始同步至美国节点 (${DEST_HOST}:${DEST_PORT})..."

# 5. 执行 MongoDB 同步
if [ "$DB_CHANGED" -eq 1 ]; then
    echo "--> [1/2] 正在同步 MongoDB 数据 (wanderlust)..."
    docker exec wanderlust-mongodb mongodump --db wanderlust --archive --gzip | \
      ssh -p "${DEST_PORT}" -o StrictHostKeyChecking=no "${DEST_USER}@${DEST_HOST}" \
      "docker exec -i wanderlust-mongodb mongorestore --nsInclude='wanderlust.*' --archive --gzip --drop"
else
    echo "--> [1/2] MongoDB 数据未变更，跳过数据库覆写。"
fi

# 6. 执行媒体文件增量同步
if [ "$MEDIA_CHANGED" -eq 1 ]; then
    echo "--> [2/2] 正在增量同步媒体文件 (/app/media)..."
    rsync -avz --delete -e "ssh -p ${DEST_PORT} -o StrictHostKeyChecking=no" \
      "$MEDIA_DIR/" \
      "${DEST_USER}@${DEST_HOST}:$MEDIA_DIR/"
else
    echo "--> [2/2] 媒体文件未变更，跳过增量传输。"
fi

# 7. 写入最新指纹文件
mkdir -p "$(dirname "$STATE_FILE")"
cat << STATE_EOF > "$STATE_FILE"
LAST_DB_HASH="$CURRENT_DB_HASH"
LAST_MEDIA_HASH="$CURRENT_MEDIA_HASH"
LAST_SYNC_TIME="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
STATE_EOF

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] ✅ 博客双活数据同步成功完成！已更新状态指纹。"
