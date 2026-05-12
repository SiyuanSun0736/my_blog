这个目录用于存放 MongoDB 备份文件。

- 默认备份脚本会输出到 `backups/mongodb/<database>-<timestamp>/dump.archive.gz`
- `backups/` 已加入 `.gitignore`，不会被提交到仓库
- 恢复时可以执行 `./scripts/restore-mongodb.sh <备份目录或 archive 文件>`