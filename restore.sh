#!/bin/sh
# My Pick 저장 파일 되살리기 · 새 서버로 옮기기:  ./restore.sh 백업파일.db
# 관리자 화면의 ‘되돌리기’와 같은 방식이에요: 백업 파일을 ‘되돌릴 파일’(restore-pending.db)로 넣고 다시 켜면,
# 서버가 지금 저장 파일을 볼륨의 backups/before-restore-… 로 남기고 바꿔요. 기록에도 ‘백업으로 되돌림’이 남아요.
# 다른 서버로 옮길 때는 .env 의 AUDIT_SECRET 을 원래 서버와 같게 넣어 주세요 (다르면 기록이 ‘어긋남’으로 보여요).
set -eu
cd "$(dirname "$0")"
f="${1:-}"
[ -n "$f" ] || { echo "사용법: ./restore.sh 백업파일.db"; exit 1; }
[ -f "$f" ] || { echo "파일이 없어요: $f"; exit 1; }
[ "$(head -c 15 "$f")" = "SQLite format 3" ] || { echo "SQLite 저장 파일이 아니에요: $f"; exit 1; }
printf '지금 저장 파일을 %s 로 바꿔요. 계속할까요? (yes 입력) ' "$f"
read -r answer
[ "$answer" = yes ] || { echo "그만뒀어요."; exit 1; }

dir="$(cd "$(dirname "$f")" && pwd)"; file="$(basename "$f")"
volume="${COMPOSE_PROJECT_NAME:-my-pick}_mypick-data"
docker compose create web >/dev/null 2>&1 || true   # 새 서버라면 볼륨부터 만들어 둬요
docker compose stop web
docker run --rm -v "$volume":/data -v "$dir":/in:ro alpine sh -c \
  "cp '/in/$file' /data/restore-pending.db && echo '$file (restore.sh)' > /data/restore-pending.db.txt && chown 1000:1000 /data/restore-pending.db /data/restore-pending.db.txt"
docker compose up -d
echo "✓ 되살렸어요. 바꾸기 전 저장 파일은 볼륨의 backups/before-restore-… 에 남아 있어요 (관리자 화면 ‘설정 → 백업’에서도 보여요)."
