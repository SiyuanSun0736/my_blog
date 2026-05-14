这个目录用于存放数据库和图片媒体备份文件。

- 默认备份脚本会输出到 `backups/mongodb/<database>-<timestamp>/`，其中包含 `dump.archive.gz`、`media.tar.gz`、`metadata.txt` 和可选的 `sha256` 校验文件
- 每次备份完成后，还会把最新一份复制到 `backups/latest-mongodb/`，方便直接恢复最近一次备份
- `backups/latest-mongodb/` 每次只保留最近一次备份的 `dump.archive.gz`、`media.tar.gz`、`metadata.txt` 和可选的 `sha256` 校验文件
- `backups/` 已加入 `.gitignore`；仓库里只保留说明文件，生成的 archive / metadata / checksum 不会被提交到仓库
- 恢复时可以执行 `./scripts/restore-mongodb.sh <备份目录或 archive 文件>`；传备份目录会同时恢复数据库和图片，最近一次可直接传 `./scripts/restore-mongodb.sh backups/latest-mongodb`