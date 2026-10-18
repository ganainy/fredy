#!/usr/bin/env bash
# Deploy the current checkout of Fredy with automatic rollback.
#
#   ./deploy.sh              git pull (fast-forward only), build, restart, health check
#   ./deploy.sh --no-pull    build and restart the code as it is checked out
#   ./deploy.sh --rollback   put the previous image back (no build)
#
# Safety net: before building, the running image is tagged `fredy-rollback:previous` and
# conf/ + db/ are archived to ~/fredy-backups. If the new container is not healthy within
# HEALTH_TIMEOUT seconds (default 150) the previous image is restored automatically.
# Note: rollback restores the image only. If a new version migrated the database, restore
# the printed backup archive as well.
set -euo pipefail

cd "$(dirname "$0")"
SERVICE=fredy
IMAGE=ghcr.io/orangecoding/fredy:latest
PREV=fredy-rollback:previous
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-150}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/fredy-backups}"
MIN_FREE_GB="${MIN_FREE_GB:-3}"

MODE=deploy
PULL=1
for a in "$@"; do
  case "$a" in
    --no-pull) PULL=0 ;;
    --rollback) MODE=rollback ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

log() { printf '\n== %s\n' "$*"; }

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) status
  while (( SECONDS < deadline )); do
    status=$(docker inspect -f '{{if .State.Running}}{{.State.Health.Status}}{{else}}stopped{{end}}' "$SERVICE" 2>/dev/null || echo missing)
    [[ "$status" == healthy ]] && return 0
    sleep 3
  done
  return 1
}

rollback() {
  docker image inspect "$PREV" >/dev/null 2>&1 || { echo "no previous image ($PREV) to roll back to" >&2; return 1; }
  log "rolling back to $PREV"
  docker tag "$PREV" "$IMAGE"
  docker compose up -d --no-build --force-recreate "$SERVICE"
  if wait_healthy; then echo "rollback OK, previous version is running"; else echo "ROLLBACK ALSO UNHEALTHY: check 'docker logs $SERVICE'" >&2; return 1; fi
}

if [[ "$MODE" == rollback ]]; then rollback; exit $?; fi

# ---- preflight
docker info >/dev/null 2>&1 || { echo "docker is not reachable" >&2; exit 1; }
free_gb=$(df -BG --output=avail "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /)" | tail -1 | tr -dc '0-9')
(( free_gb >= MIN_FREE_GB )) || { echo "only ${free_gb}G free for Docker, need ${MIN_FREE_GB}G (set MIN_FREE_GB to override)" >&2; exit 1; }

if (( PULL )); then
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "working tree has local changes; commit/stash them or use --no-pull" >&2; exit 1
  fi
  log "git pull (fast-forward only) on $(git rev-parse --abbrev-ref HEAD)"
  git pull --ff-only
fi
echo "deploying commit $(git rev-parse --short HEAD): $(git log -1 --format=%s)"

# ---- safety net
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$PREV"
  echo "previous image saved as $PREV"
else
  echo "no running image yet (first deploy), rollback will not be available"
fi
mkdir -p "$BACKUP_DIR"
ARCHIVE="$BACKUP_DIR/fredy-data-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$ARCHIVE" conf db 2>/dev/null || true
echo "data backup: $ARCHIVE"
ls -1t "$BACKUP_DIR"/fredy-data-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f

# ---- build + switch
log "building"
if ! docker compose build "$SERVICE"; then
  echo "BUILD FAILED, nothing changed: the old container is still running" >&2
  exit 1
fi

log "restarting $SERVICE"
docker compose up -d --no-build "$SERVICE"
if wait_healthy; then
  log "healthy: deploy OK ($(git rev-parse --short HEAD))"
  docker image prune -f >/dev/null || true
else
  echo "NEW VERSION NOT HEALTHY within ${HEALTH_TIMEOUT}s" >&2
  docker logs --tail 25 "$SERVICE" >&2 || true
  rollback || exit 1
  echo "deploy failed and was rolled back; data backup: $ARCHIVE" >&2
  exit 1
fi
