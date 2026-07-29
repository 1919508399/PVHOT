#!/usr/bin/env bash
#
# Atomically roll PVHOT back to the previous release or to an explicit Git SHA.
#
# Usage:
#   rollback.sh
#   rollback.sh <full-git-sha>

set -euo pipefail
IFS=$'\n\t'
umask 0027

readonly BASE_DIR="${PVHOT_BASE_DIR:-/var/www/pvhot}"
readonly RELEASES_DIR="${BASE_DIR}/releases"
readonly CURRENT_LINK="${BASE_DIR}/current"
readonly PREVIOUS_LINK="${BASE_DIR}/previous"
readonly PUBLIC_URL="${PVHOT_PUBLIC_URL:-https://pvhot.bbroot.com}"
readonly ADMIN_SERVICE="${PVHOT_ADMIN_SERVICE:-pvhot-admin.service}"
readonly SYSTEMCTL_BIN="${PVHOT_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
readonly NODE_BIN="${PVHOT_NODE_BIN:-/usr/bin/node}"

ORIGINAL_CURRENT=""
ORIGINAL_PREVIOUS=""
ACTIVATED=0
COMMITTED=0

log() {
  printf '[pvhot-rollback] %s\n' "$*"
}

die() {
  printf '[pvhot-rollback] ERROR: %s\n' "$*" >&2
  exit 1
}

validate_base_dir() {
  [[ "${BASE_DIR}" == /* ]] || die "PVHOT_BASE_DIR must be absolute"
  local normalized
  normalized="$(realpath -m -- "${BASE_DIR}")"
  case "${normalized}" in
    /var/www/*|/srv/*) ;;
    *) die "refusing unsafe base directory: ${normalized}" ;;
  esac
  [[ "${normalized}" != "/var/www" && "${normalized}" != "/srv" ]] \
    || die "base directory is too broad: ${normalized}"
  [[ -d "${BASE_DIR}" && ! -L "${BASE_DIR}" && -w "${BASE_DIR}" ]] \
    || die "base directory must exist, be writable, and not be a symlink"
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] \
    || die "git SHA must be a lowercase 40- or 64-character hexadecimal value"
}

release_from_link() {
  local link_path="$1"
  [[ -L "${link_path}" ]] || return 0
  local resolved
  resolved="$(realpath -e -- "${link_path}" 2>/dev/null || true)"
  case "${resolved}" in
    "${RELEASES_DIR}/"*) printf '%s\n' "${resolved}" ;;
    *) die "symlink points outside releases directory: ${link_path} -> ${resolved}" ;;
  esac
}

validate_release() {
  local release_dir="$1"
  local normalized
  normalized="$(realpath -e -- "${release_dir}" 2>/dev/null || true)"
  case "${normalized}" in
    "${RELEASES_DIR}/"*) ;;
    *) die "rollback target escapes releases directory: ${release_dir}" ;;
  esac
  [[ -d "${normalized}" && ! -L "${normalized}" ]] \
    || die "rollback target is not a release directory: ${normalized}"
  local sha
  sha="$(basename -- "${normalized}")"
  validate_sha "${sha}"
  [[ -f "${normalized}/release.json" ]] || die "rollback target has no release.json"
  "${NODE_BIN}" - "${normalized}/release.json" "${sha}" <<'NODE'
const fs = require('fs');
const [manifestPath, expected] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.gitSha !== expected) throw new Error('release manifest does not match directory SHA');
NODE
}

atomic_link() {
  local target="$1"
  local link_path="$2"
  local temporary="${link_path}.tmp.$$.$RANDOM"
  [[ "${link_path}" == "${BASE_DIR}/"* ]] \
    || die "refusing to replace link outside base directory: ${link_path}"
  [[ ! -e "${link_path}" || -L "${link_path}" ]] \
    || die "expected symlink but found another file type: ${link_path}"
  rm -f -- "${temporary}"
  ln -s -- "${target}" "${temporary}"
  mv -Tf -- "${temporary}" "${link_path}"
}

restart_admin() {
  if [[ "${PVHOT_SKIP_SERVICE_RESTART:-0}" == "1" ]]; then
    log "service restart skipped by PVHOT_SKIP_SERVICE_RESTART=1"
    return 0
  fi
  [[ "${SYSTEMCTL_BIN}" == /* && -x "${SYSTEMCTL_BIN}" ]] \
    || die "PVHOT_SYSTEMCTL_BIN must name an executable absolute path"
  command -v sudo >/dev/null 2>&1 || die "sudo is required for service restart"
  sudo -n "${SYSTEMCTL_BIN}" restart "${ADMIN_SERVICE}"
  sudo -n "${SYSTEMCTL_BIN}" is-active --quiet "${ADMIN_SERVICE}"
}

smoke_external() {
  local expected_sha="$1"
  local url="${PUBLIC_URL%/}"
  local temporary
  temporary="$(mktemp -d)"
  local rc=0
  {
    curl \
      --fail \
      --silent \
      --show-error \
      --location \
      --connect-timeout 5 \
      --max-time 20 \
      --retry 2 \
      --retry-delay 1 \
      --retry-connrefused \
      "${url}/?__pvhot_rollback=${expected_sha}" \
      -o "${temporary}/index.html"
    grep -qi '<html' "${temporary}/index.html"
    grep -q 'app\.js' "${temporary}/index.html"

    curl \
      --fail \
      --silent \
      --show-error \
      --location \
      --connect-timeout 5 \
      --max-time 20 \
      --retry 2 \
      --retry-delay 1 \
      --retry-connrefused \
      "${url}/data.json?__pvhot_rollback=${expected_sha}" \
      -o "${temporary}/data.json"
    "${NODE_BIN}" - "${temporary}/data.json" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!value || !Array.isArray(value.items)) throw new Error('data.json has no items array');
NODE

    curl \
      --fail \
      --silent \
      --show-error \
      --location \
      --connect-timeout 5 \
      --max-time 20 \
      --retry 2 \
      --retry-delay 1 \
      --retry-connrefused \
      "${url}/release.json?__pvhot_rollback=${expected_sha}" \
      -o "${temporary}/release.json"
    "${NODE_BIN}" - "${temporary}/release.json" "${expected_sha}" <<'NODE'
const fs = require('fs');
const [file, expected] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!value || value.gitSha !== expected) throw new Error('public release SHA mismatch');
NODE

    curl \
      --fail \
      --silent \
      --show-error \
      --location \
      --connect-timeout 5 \
      --max-time 20 \
      --retry 2 \
      --retry-delay 1 \
      --retry-connrefused \
      "${url}/api/healthz?__pvhot_rollback=${expected_sha}" \
      -o "${temporary}/health.json"
    "${NODE_BIN}" - "${temporary}/health.json" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const service = value && (value.service || value.svc);
if (!value || value.ok !== true || service !== 'pvhot-admin') {
  throw new Error('admin health check failed');
}
NODE
  } || rc=$?
  rm -rf -- "${temporary}"
  return "${rc}"
}

restore_after_failure() {
  set +e
  if (( ACTIVATED == 1 && COMMITTED == 0 )); then
    log "rollback target failed smoke checks; restoring original release"
    atomic_link "${ORIGINAL_CURRENT}" "${CURRENT_LINK}"
    if [[ -n "${ORIGINAL_PREVIOUS}" ]]; then
      atomic_link "${ORIGINAL_PREVIOUS}" "${PREVIOUS_LINK}"
    elif [[ -L "${PREVIOUS_LINK}" ]]; then
      rm -f -- "${PREVIOUS_LINK}"
    fi
    restart_admin || log "warning: admin service did not restart after recovery"
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    restore_after_failure
  fi
  exit "${rc}"
}

main() {
  (( $# <= 1 )) || {
    printf 'Usage: rollback.sh [full-git-sha]\n' >&2
    exit 2
  }

  command -v realpath >/dev/null 2>&1 || die "realpath is required"
  command -v flock >/dev/null 2>&1 || die "flock is required"
  command -v curl >/dev/null 2>&1 || die "curl is required"
  command -v grep >/dev/null 2>&1 || die "grep is required"
  [[ "${NODE_BIN}" == /* && -x "${NODE_BIN}" ]] \
    || die "PVHOT_NODE_BIN must name an executable absolute path"
  [[ "${PUBLIC_URL}" =~ ^https?://[^[:space:]/]+(:[0-9]+)?(/.*)?$ ]] \
    || die "invalid PVHOT_PUBLIC_URL: ${PUBLIC_URL}"
  validate_base_dir

  exec 9>"${BASE_DIR}/.deploy.lock"
  flock -w 120 9 || die "timed out waiting for deployment lock"
  trap on_exit EXIT

  ORIGINAL_CURRENT="$(release_from_link "${CURRENT_LINK}")"
  ORIGINAL_PREVIOUS="$(release_from_link "${PREVIOUS_LINK}")"
  [[ -n "${ORIGINAL_CURRENT}" ]] || die "there is no active release to roll back"

  local target
  if (( $# == 1 )); then
    validate_sha "$1"
    target="${RELEASES_DIR}/$1"
  else
    [[ -n "${ORIGINAL_PREVIOUS}" ]] || die "there is no previous release"
    target="${ORIGINAL_PREVIOUS}"
  fi

  validate_release "${target}"
  target="$(realpath -e -- "${target}")"
  [[ "${target}" != "${ORIGINAL_CURRENT}" ]] || die "requested release is already active"
  local target_sha
  target_sha="$(basename -- "${target}")"

  atomic_link "${ORIGINAL_CURRENT}" "${PREVIOUS_LINK}"
  atomic_link "${target}" "${CURRENT_LINK}"
  ACTIVATED=1

  restart_admin
  smoke_external "${target_sha}" || die "rollback target failed external smoke checks"

  COMMITTED=1
  log "active release is now ${target_sha}; former release=$(basename -- "${ORIGINAL_CURRENT}")"
}

main "$@"
