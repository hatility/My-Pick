#!/bin/sh
# My Pick 저장 파일 백업:  ./backup.sh   →  backups/mypick-YYYYMMDD-HHMM.db
# 서버를 멈추지 않고, SQLite 의 VACUUM INTO 로 ‘한 순간의 온전한 사본’을 만들어요.
# (서버도 하루 한 번 볼륨 안 backups 폴더에 스스로 백업해요. 이 스크립트는 서버 밖으로 꺼내 둘 때 써요)
# 되살릴 때 기록이 ‘이어져 있어요’로 나오려면 .env 의 AUDIT_SECRET 도 같이 보관해 두세요.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
name="mypick-$(date +%Y%m%d-%H%M).db"
docker compose exec -T web node -e "
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync('/data/mypick.db')
  db.exec(\"VACUUM INTO '/data/.backup-tmp.db'\")
  db.close()
" 2>/dev/null
docker compose cp web:/data/.backup-tmp.db "backups/$name"
docker compose exec -T web rm -f /data/.backup-tmp.db
echo "✓ backups/$name  (방 · 주제 · 결과 · 기록이 들어 있어요. 안전한 곳에만 보관해 주세요)"
