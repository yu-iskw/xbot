#!/usr/bin/env bash
# Drive the built xbot CLI against an isolated mock-mode home.
# Evidence is written outside the data directory so cleanup can remove the home and leave the proof.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$script_dir
while [[ ! -f "$root/pnpm-workspace.yaml" && "$root" != "/" ]]; do
  root=$(dirname "$root")
done
if [[ ! -f "$root/pnpm-workspace.yaml" ]]; then
  echo "xbot-verify: could not find the workspace root from $script_dir" >&2
  exit 1
fi

bin="$root/packages/cli/dist/bin.js"
pointer=/tmp/xbot-verify-current

die() {
  echo "xbot-verify: $*" >&2
  exit 1
}

load_run() {
  local id="${XBOT_VERIFY_RUN:-}"
  if [[ -z "$id" ]]; then
    [[ -f "$pointer" ]] || die "no active run. Run launch first, or set XBOT_VERIFY_RUN."
    id=$(<"$pointer")
  fi
  local env_file="/tmp/xbot-verify-evidence-$id/run.env"
  [[ -f "$env_file" ]] || die "missing $env_file"
  # shellcheck disable=SC1090
  source "$env_file"
  [[ "$XBOT_VERIFY_DATA" == /tmp/xbot-verify-data-* ]] || die "refusing unexpected data dir $XBOT_VERIFY_DATA"
  [[ -d "$XBOT_VERIFY_DATA" || "${1:-}" == "cleanup" ]] || die "data dir is gone: $XBOT_VERIFY_DATA"
}

isolated_xbot() {
  (
    cd "$XBOT_VERIFY_DATA"
    env \
      XBOT_HOME="$XBOT_VERIFY_DATA" \
      X_BEARER_TOKEN= \
      XBOT_X_BEARER_TOKEN= \
      XBOT_DB_URL= \
      XBOT_DB_AUTH_TOKEN= \
      XBOT_CONFIG= \
      XBOT_MODEL= \
      XBOT_MODEL_CHAT= \
      XBOT_MODEL_PLANNING= \
      XBOT_MODEL_ANALYSIS= \
      XBOT_MODEL_REPORTING= \
      XBOT_X_MODE= \
      XBOT_TENANT= \
      node "$XBOT_VERIFY_BIN" "$@"
  )
}

capture() {
  local feature=$1
  shift
  load_run
  local out="$XBOT_VERIFY_EVIDENCE/$feature.stdout"
  local err="$XBOT_VERIFY_EVIDENCE/$feature.stderr"
  local code_file="$XBOT_VERIFY_EVIDENCE/$feature.exit"
  set +e
  isolated_xbot "$@" >"$out" 2>"$err"
  local code=$?
  set -e
  printf '%s\n' "$code" >"$code_file"
  cat "$out"
  cat "$err" >&2
  echo "xbot-verify: $feature exit $code evidence $XBOT_VERIFY_EVIDENCE/$feature.*" >&2
  return "$code"
}

cmd=${1:-}
shift || true

case "$cmd" in
  launch)
    [[ -f "$bin" ]] || (cd "$root" && pnpm install && pnpm build)
    [[ -f "$bin" ]] || die "missing $bin after build"
    version=$(node "$bin" --version | tr -d '\r')
    [[ "$version" == "0.1.0" ]] || die "expected xbot 0.1.0, got $version"
    id=$(date -u +%Y%m%dT%H%M%SZ)-$$
    data=/tmp/xbot-verify-data-$id
    evidence=/tmp/xbot-verify-evidence-$id
    mkdir -p "$data" "$evidence"
    cat >"$evidence/run.env" <<EOF
XBOT_VERIFY_RUN=$id
XBOT_VERIFY_DATA=$data
XBOT_VERIFY_EVIDENCE=$evidence
XBOT_VERIFY_BIN=$bin
XBOT_VERIFY_ROOT=$root
XBOT_VERIFY_VERSION=$version
EOF
    printf '%s\n' "$id" >"$pointer"
    printf 'ready xbot %s\nrun %s\ndata %s\nevidence %s\n' "$version" "$id" "$data" "$evidence"
    ;;
  paths)
    load_run
    printf 'run %s\ndata %s\nevidence %s\nbin %s\n' \
      "$XBOT_VERIFY_RUN" "$XBOT_VERIFY_DATA" "$XBOT_VERIFY_EVIDENCE" "$XBOT_VERIFY_BIN"
    ;;
  doctor)
    capture doctor doctor
    load_run
    grep -F "xbot doctor" "$XBOT_VERIFY_EVIDENCE/doctor.stdout" >/dev/null
    grep -F "X mode:        mock (no credentials required)" "$XBOT_VERIFY_EVIDENCE/doctor.stdout" >/dev/null
    grep -F "X access:      read-only (search, post lookup, user lookup, user timelines)" "$XBOT_VERIFY_EVIDENCE/doctor.stdout" >/dev/null
    grep -F "$XBOT_VERIFY_DATA" "$XBOT_VERIFY_EVIDENCE/doctor.stdout" >/dev/null
    grep -F "Tenant:        default" "$XBOT_VERIFY_EVIDENCE/doctor.stdout" >/dev/null
    grep -F "Chat:          unavailable (set XBOT_MODEL)" "$XBOT_VERIFY_EVIDENCE/doctor.stdout" >/dev/null
    grep -F "X mode: mock" "$XBOT_VERIFY_EVIDENCE/doctor.stderr" >/dev/null
    [[ "$(cat "$XBOT_VERIFY_EVIDENCE/doctor.exit")" == "0" ]]
    echo "xbot-verify: doctor ok"
    ;;
  run)
    [[ $# -ge 2 && "$2" == "--" ]] || die "usage: xbot-verify.sh run <feature-id> -- <xbot args>"
    feature=$1
    shift 2
    capture "$feature" "$@"
    ;;
  run-stdin)
    [[ $# -ge 2 && "$2" == "--" ]] || die "usage: xbot-verify.sh run-stdin <feature-id> -- <xbot args>"
    feature=$1
    shift 2
    capture "$feature" "$@"
    ;;
  cleanup)
    load_run cleanup
    case "$XBOT_VERIFY_DATA" in
      /tmp/xbot-verify-data-*) ;;
      *) die "refusing to delete $XBOT_VERIFY_DATA" ;;
    esac
    rm -rf "$XBOT_VERIFY_DATA"
    if [[ -f "$pointer" && "$(<"$pointer")" == "$XBOT_VERIFY_RUN" ]]; then
      rm -f "$pointer"
    fi
    [[ -d "$XBOT_VERIFY_EVIDENCE" ]] || die "evidence directory disappeared"
    echo "xbot-verify: removed $XBOT_VERIFY_DATA"
    echo "xbot-verify: evidence kept at $XBOT_VERIFY_EVIDENCE"
    ;;
  *)
    die "usage: xbot-verify.sh launch | paths | doctor | run <feature-id> -- <xbot args> | run-stdin <feature-id> -- <xbot args> | cleanup"
    ;;
esac
