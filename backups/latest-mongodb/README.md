这个目录保留最近一次 MongoDB 备份的可跟踪副本。

- `scripts/backup-mongodb.sh` 在生成常规时间戳备份后，会把最新的 `dump.archive.gz`、`metadata.txt` 和可选的 `dump.archive.gz.sha256` 同步到这里
- 每次同步前都会清理上一次的备份文件，因此这里始终只保留最近一份
- 恢复时可直接执行 `./scripts/restore-mongodb.sh backups/latest-mongodb`