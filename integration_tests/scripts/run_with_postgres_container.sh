#!/usr/bin/env bash
set -euo pipefail

INTEGRATION_TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${INTEGRATION_TESTS_DIR}/docker-compose.postgres.yml"
CONTAINER_NAME="dbt-package-template-postgres"
WAIT_SECONDS="${POSTGRES_WAIT_TIMEOUT_SECONDS:-60}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

ensure_docker_prereqs() {
  require_command docker

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but the daemon is not reachable." >&2
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required for Postgres-backed local tests." >&2
    exit 1
  fi
}

ensure_port_available() {
  if lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 5432 is already in use. Stop the existing listener or change the Postgres host port." >&2
    exit 1
  fi
}

postgres_up() {
  docker compose -f "${COMPOSE_FILE}" up -d postgres
}

postgres_logs() {
  docker compose -f "${COMPOSE_FILE}" logs --no-color postgres || true
}

postgres_down() {
  docker compose -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true
}

postgres_wait() {
  local started_at
  started_at="$(date +%s)"

  while true; do
    local state
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)"

    if [[ "${state}" == "healthy" ]]; then
      return 0
    fi

    if [[ -z "${state}" ]]; then
      echo "Postgres container ${CONTAINER_NAME} was not created successfully." >&2
      return 1
    fi

    if (( "$(date +%s)" - started_at >= WAIT_SECONDS )); then
      echo "Timed out waiting for Postgres to become healthy after ${WAIT_SECONDS}s." >&2
      return 1
    fi

    sleep 1
  done
}

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command> [args ...]" >&2
  exit 1
fi

ensure_docker_prereqs
ensure_port_available
postgres_up

cleanup() {
  local exit_code="$1"
  if [[ "${exit_code}" -ne 0 ]]; then
    postgres_logs
  fi
  postgres_down
  exit "${exit_code}"
}

trap 'cleanup $?' EXIT

postgres_wait
cd "${INTEGRATION_TESTS_DIR}"
"$@"
