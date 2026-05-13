这个目录用于存放 MongoDB 备份文件。

- 默认备份脚本会输出到 `backups/mongodb/<database>-<timestamp>/dump.archive.gz`
- 每次备份完成后，还会把最新一份复制到 `backups/latest-mongodb/`，方便直接恢复最近一次备份
- `backups/latest-mongodb/` 每次只保留最近一次备份的 `dump.archive.gz`、`metadata.txt` 和可选的 `dump.archive.gz.sha256`
- `backups/` 已加入 `.gitignore`；仓库里只保留说明文件，生成的 archive / metadata / checksum 不会被提交到仓库
- 恢复时可以执行 `./scripts/restore-mongodb.sh <备份目录或 archive 文件>`，最近一次可直接传 `./scripts/restore-mongodb.sh backups/latest-mongodb`