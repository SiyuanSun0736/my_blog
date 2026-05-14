这个目录保留最近一次数据库与图片媒体备份的可跟踪副本。

- `scripts/backup-mongodb.sh` 在生成常规时间戳备份后，会把最新的 `dump.archive.gz`、`media.tar.gz`、`metadata.txt` 和可选的 `sha256` 校验文件同步到这里
- 每次同步前都会清理上一次的备份文件，因此这里始终只保留最近一份
- 目录本身和 `README.md` 会保留在仓库中，但生成的 archive / metadata / checksum 默认不再纳入 git 跟踪
- 恢复时可直接执行 `./scripts/restore-mongodb.sh backups/latest-mongodb`，数据库和图片会一起恢复