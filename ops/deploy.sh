#!/usr/bin/env bash
#
# Deploy one immutable PVHOT release and atomically switch `current`.
#
# Usage:
#   deploy.sh /absolute/path/pvhot-<git-sha>.tar.gz <git-sha>
#
# The archive must be produced from the exact commit named by <git-sha>.
# This script intentionally contains no credentials. Service control is limited
# to a narrowly-scoped, passwordless sudo rule documented in ops/README.md.

set -euo pipefail
IFS=$'\n\t'
umask 0027

readonly BASE_DIR="${PVHOT_BASE_DIR:-/var/www/pvhot}"
readonly RELEASES_DIR="${BASE_DIR}/releases"
readonly SHARED_DIR="${BASE_DIR}/shared"
readonly CURRENT_LINK="${BASE_DIR}/current"
readonly PREVIOUS_LINK="${BASE_DIR}/previous"
readonly PUBLIC_URL="${PVHOT_PUBLIC_URL:-https://pvhot.bbroot.com}"
readonly KEEP_RELEASES="${PVHOT_KEEP_RELEASES:-5}"
readonly ADMIN_SERVICE="${PVHOT_ADMIN_SERVICE:-pvhot-admin.service}"
readonly RUNTIME_USER="${PVHOT_RUNTIME_USER:-pvhot}"
readonly RUNTIME_GROUP="${PVHOT_RUNTIME_GROUP:-pvhot}"
readonly SYSTEMCTL_BIN="${PVHOT_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
readonly NODE_BIN="${PVHOT_NODE_BIN:-/usr/bin/node}"
readonly NPM_BIN="${PVHOT_NPM_BIN:-/usr/bin/npm}"
readonly SKIP_EXTERNAL_SMOKE="${PVHOT_SKIP_EXTERNAL_SMOKE:-0}"

STAGING_DIR=""
OLD_CURRENT=""
OLD_PREVIOUS=""
ACTIVATED=0
COMMITTED=0

log() {
  printf '[pvhot-deploy] %s\n' "$*"
}

die() {
  printf '[pvhot-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy.sh /absolute/path/pvhot-<40-or-64-char-git-sha>.tar.gz <git-sha>

Optional environment:
  PVHOT_BASE_DIR=/var/www/pvhot
  PVHOT_PUBLIC_URL=https://pvhot.bbroot.com
  PVHOT_KEEP_RELEASES=5
  PVHOT_SKIP_SERVICE_RESTART=1
  PVHOT_SKIP_EXTERNAL_SMOKE=1  # bootstrap only; rejected once current exists
EOF
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
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
  [[ ! -L "${BASE_DIR}" ]] || die "base directory must not be a symlink: ${BASE_DIR}"
  [[ -d "${BASE_DIR}" && -w "${BASE_DIR}" ]] \
    || die "base directory must already exist and be writable by $(id -un): ${BASE_DIR}"
}

validate_public_url() {
  [[ "${PUBLIC_URL}" =~ ^https?://[^[:space:]/]+(:[0-9]+)?(/.*)?$ ]] \
    || die "invalid PVHOT_PUBLIC_URL: ${PUBLIC_URL}"
}

validate_sha() {
  local sha="$1"
  [[ "${sha}" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] \
    || die "git SHA must be a lowercase 40- or 64-character hexadecimal value"
}

validate_release_path() {
  local candidate="$1"
  local normalized
  normalized="$(realpath -m -- "${candidate}")"
  case "${normalized}" in
    "${RELEASES_DIR}/"*) ;;
    *) die "release path escapes releases directory: ${normalized}" ;;
  esac
  [[ "$(basename -- "${normalized}")" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] \
    || die "release directory is not named by a full git SHA: ${normalized}"
}

validate_archive_entries() {
  local artifact="$1"
  local entry normalized
  local entry_count=0

  while IFS= read -r entry; do
    entry_count=$((entry_count + 1))
    normalized="${entry#./}"
    [[ -n "${normalized}" ]] || continue
    [[ "${normalized}" != /* ]] || die "archive contains an absolute path: ${entry}"
    [[ ! "${normalized}" =~ (^|/)\.\.(/|$) ]] \
      || die "archive contains a parent-directory path: ${entry}"
  done < <(tar -tzf "${artifact}")

  (( entry_count > 0 )) || die "release archive is empty"
}

safe_remove_staging() {
  local candidate="$1"
  [[ -n "${candidate}" ]] || return 0
  local normalized
  normalized="$(realpath -m -- "${candidate}")"
  case "${normalized}" in
    "${RELEASES_DIR}/.staging-"*) rm -rf -- "${normalized}" ;;
    *) log "refusing to remove unexpected staging path: ${normalized}" ;;
  esac
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

current_release() {
  local link_path="$1"
  if [[ ! -L "${link_path}" ]]; then
    return 0
  fi
  local resolved
  resolved="$(realpath -e -- "${link_path}" 2>/dev/null || true)"
  case "${resolved}" in
    "${RELEASES_DIR}/"*) printf '%s\n' "${resolved}" ;;
    *) die "symlink points outside releases directory: ${link_path} -> ${resolved}" ;;
  esac
}

restart_admin() {
  if [[ "${PVHOT_SKIP_SERVICE_RESTART:-0}" == "1" ]]; then
    log "service restart skipped by PVHOT_SKIP_SERVICE_RESTART=1"
    return 0
  fi
  [[ "${SYSTEMCTL_BIN}" == /* && -x "${SYSTEMCTL_BIN}" ]] \
    || die "PVHOT_SYSTEMCTL_BIN must name an executable absolute path"
  require_command sudo
  sudo -n "${SYSTEMCTL_BIN}" restart "${ADMIN_SERVICE}"
  sudo -n "${SYSTEMCTL_BIN}" is-active --quiet "${ADMIN_SERVICE}"
}

set_or_verify_shared_file_permissions() {
  local shared_path="$1"
  local expected_mode="$2"

  [[ -f "${shared_path}" && ! -L "${shared_path}" ]] \
    || die "shared file is missing, not regular, or is a symlink: ${shared_path}"

  local actual_owner actual_group actual_mode deploy_owner
  deploy_owner="$(id -un)"
  actual_owner="$(stat -c '%U' "${shared_path}")"
  actual_group="$(stat -c '%G' "${shared_path}")"
  actual_mode="$(stat -c '%a' "${shared_path}")"
  if [[ ( "${actual_owner}" == "${deploy_owner}"
          || "${actual_owner}" == "${RUNTIME_USER}"
          || "${actual_owner}" == "root" )
        && "${actual_group}" == "${RUNTIME_GROUP}"
        && "${actual_mode}" == "${expected_mode#0}" ]]; then
    return 0
  fi
  if [[ "${actual_owner}" == "${RUNTIME_USER}"
        && "${actual_group}" == "${RUNTIME_GROUP}"
        && "${expected_mode#0}" == "660"
        && "${actual_mode}" == "640" ]]; then
    log "accepted runtime-owned shared file with owner-write/group-read mode: ${shared_path}"
    return 0
  fi
  die "shared file has unsafe ownership/mode: ${shared_path} (${actual_owner}:${actual_group}:${actual_mode}); expected ${RUNTIME_USER}:${RUNTIME_GROUP} mode ${expected_mode}"
}

publish_new_shared_file() {
  local shared_path="$1"
  local mode="$2"
  local source_path="$3"
  local has_default="$4"
  local default_content="$5"
  local temporary

  temporary="$(mktemp "${RELEASES_DIR}/.shared-seed.XXXXXX")"
  if [[ -n "${source_path}" ]]; then
    if ! cp -- "${source_path}" "${temporary}"; then
      rm -f -- "${temporary}"
      die "failed to prepare shared file: ${shared_path}"
    fi
  elif [[ "${has_default}" == "1" ]]; then
    if ! printf '%s' "${default_content}" >"${temporary}"; then
      rm -f -- "${temporary}"
      die "failed to prepare shared file: ${shared_path}"
    fi
  else
    rm -f -- "${temporary}"
    die "cannot initialize required shared file: ${shared_path}"
  fi

  if ! chgrp "${RUNTIME_GROUP}" "${temporary}" || ! chmod "${mode}" "${temporary}"; then
    rm -f -- "${temporary}"
    die "failed to secure new shared file: ${shared_path}"
  fi

  if ln -T -- "${temporary}" "${shared_path}" 2>/dev/null; then
    rm -f -- "${temporary}"
    return 0
  fi

  rm -f -- "${temporary}"
  [[ -e "${shared_path}" || -L "${shared_path}" ]] \
    || die "failed to publish shared file: ${shared_path}"
  log "shared file appeared during initialization; validating it without modification: ${shared_path}"
}

seed_file() {
  local has_default=0
  (( $# >= 4 )) && has_default=1
  local relative_path="$1"
  local shared_path="$2"
  local fallback_source="${3:-}"
  local default_content="${4:-}"
  local mode="${5:-0660}"
  local legacy_source="${BASE_DIR}/${relative_path}"
  local release_source="${STAGING_DIR}/${relative_path}"

  [[ "${shared_path}" == "${SHARED_DIR}/"* ]] \
    || die "shared target escapes shared directory: ${shared_path}"
  mkdir -p -- "$(dirname -- "${shared_path}")"

  if [[ ! -e "${shared_path}" && ! -L "${shared_path}" ]]; then
    local seed_source=""
    if [[ -f "${legacy_source}" && ! -L "${legacy_source}" ]]; then
      seed_source="${legacy_source}"
      log "seeded shared/${relative_path} from legacy production data"
    elif [[ -f "${release_source}" && ! -L "${release_source}" ]]; then
      seed_source="${release_source}"
    elif [[ -n "${fallback_source}"
            && -f "${fallback_source}"
            && ! -L "${fallback_source}" ]]; then
      seed_source="${fallback_source}"
    fi
    publish_new_shared_file \
      "${shared_path}" \
      "${mode}" \
      "${seed_source}" \
      "${has_default}" \
      "${default_content}"
  fi
  set_or_verify_shared_file_permissions "${shared_path}" "${mode}"
}

sync_release_changelog() {
  local release_texts="${STAGING_DIR}/site_texts.json"
  local shared_texts="${SHARED_DIR}/data/site_texts.json"
  local shared_fallback="${SHARED_DIR}/data/site_texts_fallback.js"

  [[ -f "${release_texts}" ]] || die "release is missing site_texts.json"
  [[ -f "${shared_texts}" && ! -L "${shared_texts}" ]] \
    || die "shared site_texts.json is missing or unsafe"
  [[ -f "${shared_fallback}" && ! -L "${shared_fallback}" ]] \
    || die "shared site_texts_fallback.js is missing or unsafe"

  "${NODE_BIN}" - "${release_texts}" "${shared_texts}" "${shared_fallback}" <<'NODE'
const fs = require('fs');
const path = require('path');
const [releasePath, sharedPath, fallbackPath] = process.argv.slice(2);

const releaseTexts = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
const sharedTexts = JSON.parse(fs.readFileSync(sharedPath, 'utf8'));
if (!releaseTexts || !releaseTexts.changelog || !Array.isArray(releaseTexts.changelog.items)) {
  throw new Error('release changelog is invalid');
}

const nextTexts = {
  ...sharedTexts,
  changelog: releaseTexts.changelog,
};

function writeAtomic(filePath, content) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

writeAtomic(sharedPath, `${JSON.stringify(nextTexts, null, 2)}\n`);
writeAtomic(
  fallbackPath,
  `// 由 admin_server.js 同步自 site_texts.json\nwindow.SITE_TEXTS = ${JSON.stringify(nextTexts, null, 2)};\n`
);
NODE

  chgrp "${RUNTIME_GROUP}" "${shared_texts}" "${shared_fallback}"
  chmod 0660 "${shared_texts}" "${shared_fallback}"
  log "synced release changelog into shared site texts"
}

link_shared_file() {
  local relative_path="$1"
  local shared_path="$2"
  local release_path="${STAGING_DIR}/${relative_path}"

  [[ "${release_path}" == "${STAGING_DIR}/"* ]] \
    || die "release link escapes staging directory: ${release_path}"
  mkdir -p -- "$(dirname -- "${release_path}")"
  if [[ -d "${release_path}" && ! -L "${release_path}" ]]; then
    die "expected file but found directory in release: ${relative_path}"
  fi
  rm -f -- "${release_path}"
  ln -s -- "${shared_path}" "${release_path}"
}

link_shared_directory() {
  local relative_path="$1"
  local shared_path="$2"
  local release_path="${STAGING_DIR}/${relative_path}"

  [[ "${release_path}" == "${STAGING_DIR}/"* ]] \
    || die "release directory link escapes staging directory: ${release_path}"
  [[ "${shared_path}" == "${SHARED_DIR}/"* ]] \
    || die "shared directory escapes shared root: ${shared_path}"

  mkdir -p -- "${shared_path}" "$(dirname -- "${release_path}")"
  chgrp "${RUNTIME_GROUP}" "${shared_path}"
  chmod 2770 "${shared_path}"
  if [[ -d "${release_path}" && ! -L "${release_path}" ]]; then
    if [[ -z "$(find "${shared_path}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      cp -R --no-preserve=ownership,mode -- "${release_path}/." "${shared_path}/"
      find "${shared_path}" -type d -exec chgrp "${RUNTIME_GROUP}" {} + -exec chmod 2770 {} +
      find "${shared_path}" -type f -exec chgrp "${RUNTIME_GROUP}" {} + -exec chmod 0660 {} +
    fi
    rm -rf -- "${release_path}"
  else
    rm -f -- "${release_path}"
  fi
  ln -s -- "${shared_path}" "${release_path}"
}

initialize_shared_state() {
  mkdir -p \
    "${SHARED_DIR}/data" \
    "${SHARED_DIR}/content" \
    "${SHARED_DIR}/config" \
    "${SHARED_DIR}/log" \
    "${SHARED_DIR}/uploads" \
    "${SHARED_DIR}/run/locks" \
    "${SHARED_DIR}/runtime/npm-cache" \
    "${SHARED_DIR}/acme"

  chgrp "${RUNTIME_GROUP}" \
    "${SHARED_DIR}" \
    "${SHARED_DIR}/data" \
    "${SHARED_DIR}/content" \
    "${SHARED_DIR}/config" \
    "${SHARED_DIR}/log" \
    "${SHARED_DIR}/uploads" \
    "${SHARED_DIR}/run" \
    "${SHARED_DIR}/run/locks" \
    "${SHARED_DIR}/runtime" \
    "${SHARED_DIR}/runtime/npm-cache" \
    "${SHARED_DIR}/acme"

  chmod 2770 \
    "${SHARED_DIR}" \
    "${SHARED_DIR}/data" \
    "${SHARED_DIR}/content" \
    "${SHARED_DIR}/config" \
    "${SHARED_DIR}/log" \
    "${SHARED_DIR}/uploads" \
    "${SHARED_DIR}/run" \
    "${SHARED_DIR}/run/locks" \
    "${SHARED_DIR}/runtime" \
    "${SHARED_DIR}/runtime/npm-cache" \
    "${SHARED_DIR}/acme"

  seed_file "data.json" \
    "${SHARED_DIR}/data/data.json"
  seed_file "data_fallback.js" \
    "${SHARED_DIR}/data/data_fallback.js"
  seed_file "site_texts.json" \
    "${SHARED_DIR}/data/site_texts.json"
  seed_file "site_texts_fallback.js" \
    "${SHARED_DIR}/data/site_texts_fallback.js"
  sync_release_changelog
  seed_file "data_raw.json" \
    "${SHARED_DIR}/data/data_raw.json" \
    "${SHARED_DIR}/data/data.json"
  seed_file "admin_edits.json" \
    "${SHARED_DIR}/data/admin_edits.json" \
    "" \
    '{"deleted":[],"overrides":{},"added":[]}'
  seed_file "feedback.json" \
    "${SHARED_DIR}/data/feedback.json" \
    "" \
    '[]'
  seed_file "stats.json" \
    "${SHARED_DIR}/data/stats.json" \
    "" \
    '{"days":{},"total":{"pv":0,"uv":0,"ips":[]}}'
  seed_file "source_health.json" \
    "${SHARED_DIR}/data/source_health.json" \
    "" \
    '{}'
  seed_file "custom_sources.json" \
    "${SHARED_DIR}/data/custom_sources.json" \
    "" \
    '{"schemaVersion":1,"revision":0,"updatedAt":null,"sources":[]}'
  seed_file "translate_cache.json" \
    "${SHARED_DIR}/data/translate_cache.json" \
    "" \
    '{}'
  seed_file "article_cache.json" \
    "${SHARED_DIR}/data/article_cache.json" \
    "" \
    '{}'
  seed_file "ai_cache.json" \
    "${SHARED_DIR}/data/ai_cache.json" \
    "" \
    '{"schemaVersion":1,"entries":{}}'
  seed_file "ai_usage.json" \
    "${SHARED_DIR}/data/ai_usage.json" \
    "" \
    '{}'
  seed_file "wechat_items.json" \
    "${SHARED_DIR}/data/wechat_items.json" \
    "" \
    '{"items":[]}'
  seed_file "wechat_gateway_items.json" \
    "${SHARED_DIR}/data/wechat_gateway_items.json" \
    "" \
    '{"provider":"weread-bridge-experimental","experimental":true,"health":[],"count":0,"items":[]}'
  if [[ ! -e "${SHARED_DIR}/config/wechat-bootstrap-token" \
        && ! -L "${SHARED_DIR}/config/wechat-bootstrap-token" ]]; then
    local wechat_bootstrap_seed="${STAGING_DIR}/.wechat-bootstrap-token.seed"
    "${NODE_BIN}" - "${wechat_bootstrap_seed}" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
fs.writeFileSync(process.argv[2], `${crypto.randomBytes(32).toString('base64url')}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});
NODE
    publish_new_shared_file \
      "${SHARED_DIR}/config/wechat-bootstrap-token" \
      0640 \
      "${wechat_bootstrap_seed}" \
      0 \
      ""
    rm -f -- "${wechat_bootstrap_seed}"
  fi
  set_or_verify_shared_file_permissions \
    "${SHARED_DIR}/config/wechat-bootstrap-token" 0640
  seed_file "wechat-desktop-token.sha256" \
    "${SHARED_DIR}/config/wechat-desktop-token.sha256" \
    "" \
    "" \
    0640
  seed_file "fetch.log" \
    "${SHARED_DIR}/log/fetch.log" \
    "" \
    ""
  seed_file "pvhot-skill/SKILL.md" \
    "${SHARED_DIR}/content/pvhot-skill-SKILL.md"

  if [[ ! -e "${SHARED_DIR}/data/data_bootstrap.json" ]]; then
    local bootstrap_seed_source=""
    if [[ -f "${BASE_DIR}/data_bootstrap.json" && ! -L "${BASE_DIR}/data_bootstrap.json" ]]; then
      bootstrap_seed_source="${BASE_DIR}/data_bootstrap.json"
    elif [[ -f "${STAGING_DIR}/data_bootstrap.json" ]]; then
      bootstrap_seed_source="${STAGING_DIR}/data_bootstrap.json"
    else
      bootstrap_seed_source="${STAGING_DIR}/.data_bootstrap.seed.json"
      "${NODE_BIN}" - "${SHARED_DIR}/data/data.json" "${bootstrap_seed_source}" <<'NODE'
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
const bootstrap = {
  ...data,
  items: Array.isArray(data.items) ? data.items.slice(0, 36) : [],
};
const temporary = `${target}.tmp.${process.pid}`;
fs.writeFileSync(temporary, JSON.stringify(bootstrap), 'utf8');
fs.renameSync(temporary, target);
NODE
    fi
    publish_new_shared_file \
      "${SHARED_DIR}/data/data_bootstrap.json" \
      0660 \
      "${bootstrap_seed_source}" \
      0 \
      ""
    if [[ "${bootstrap_seed_source}" == "${STAGING_DIR}/.data_bootstrap.seed.json" ]]; then
      rm -f -- "${bootstrap_seed_source}"
    fi
  fi
  set_or_verify_shared_file_permissions "${SHARED_DIR}/data/data_bootstrap.json" 0660

  if [[ ! -e "${SHARED_DIR}/config/admin_pass.txt" && -f "${BASE_DIR}/admin_pass.txt" ]]; then
    publish_new_shared_file \
      "${SHARED_DIR}/config/admin_pass.txt" \
      0640 \
      "${BASE_DIR}/admin_pass.txt" \
      0 \
      ""
  fi
  if [[ -e "${SHARED_DIR}/config/admin_pass.txt" ]]; then
    set_or_verify_shared_file_permissions "${SHARED_DIR}/config/admin_pass.txt" 0640
  fi

  if [[ -d "${BASE_DIR}/uploads" \
        && -z "$(find "${SHARED_DIR}/uploads" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    cp -R --no-preserve=ownership,mode -- "${BASE_DIR}/uploads/." "${SHARED_DIR}/uploads/"
    find "${SHARED_DIR}/uploads" -type d -exec chgrp "${RUNTIME_GROUP}" {} + -exec chmod 2770 {} +
    find "${SHARED_DIR}/uploads" -type f -exec chgrp "${RUNTIME_GROUP}" {} + -exec chmod 0660 {} +
  fi
}

wire_shared_state() {
  local name
  for name in \
    data.json \
    data_fallback.js \
    data_bootstrap.json \
    data_raw.json \
    admin_edits.json \
    feedback.json \
    stats.json \
    source_health.json \
    translate_cache.json \
    article_cache.json \
    ai_cache.json \
    ai_usage.json \
    wechat_items.json \
    wechat_gateway_items.json \
    site_texts.json \
    site_texts_fallback.js; do
    link_shared_file "${name}" "${SHARED_DIR}/data/${name}"
  done

  link_shared_file "fetch.log" "${SHARED_DIR}/log/fetch.log"
  link_shared_file "admin_pass.txt" "${SHARED_DIR}/config/admin_pass.txt"
  link_shared_file "pvhot-skill/SKILL.md" "${SHARED_DIR}/content/pvhot-skill-SKILL.md"
  link_shared_directory "uploads" "${SHARED_DIR}/uploads"
  link_shared_directory ".locks" "${SHARED_DIR}/run/locks"
}

install_dependencies() {
  [[ -f "${STAGING_DIR}/package.json" ]] || die "release is missing package.json"
  [[ -f "${STAGING_DIR}/package-lock.json" ]] || die "release is missing package-lock.json"

  local node_major
  node_major="$("${NODE_BIN}" -p "process.versions.node.split('.')[0]")"
  [[ "${node_major}" == "22" ]] \
    || die "PVHOT requires Node.js 22; target currently has Node.js $("${NODE_BIN}" --version)"

  log "installing locked production dependencies"
  (
    cd "${STAGING_DIR}"
    PUPPETEER_SKIP_DOWNLOAD=true \
    npm_config_cache="${SHARED_DIR}/runtime/npm-cache" \
      "${NPM_BIN}" ci \
        --omit=dev \
        --ignore-scripts \
        --no-audit \
        --no-fund
  )
}

preflight_release() {
  local release_dir="$1"
  local verify_dependencies="${2:-1}"
  local required
  local required_files=(
    index.html
    styles.css
    app.js
    admin.html
    admin_server.js
    bd_push.py
    fetch_pv_news.js
    fetch_prices.js
    fetch_wechat.js
    wechat_gateway/server.js
    wechat_gateway/gateway.js
    wechat_gateway/storage.js
    wechat_gateway/platform_client.js
    wechat_gateway/prototype_sources.js
    merge.js
    source_registry.js
    lib/safe_io.js
    lib/process_lock.js
    lib/wechat_run_status.js
    lib/source_health.js
    lib/custom_sources.js
    lib/safe_remote_fetch.js
    lib/x_sources.js
    lib/ai_config.js
    lib/ai_editor.js
    lib/source_catalog.js
    lib/seo.js
    scripts/submit-indexnow.js
    site_texts.json
    site_texts_fallback.js
    data.json
    data_fallback.js
    package.json
    package-lock.json
    pvhot-skill/SKILL.md
    pvhot-skill/install.sh
    robots.txt
    sitemap.xml
    og-image-v4.jpg
    baidu_verify_codeva-vHjUI6fnHC.html
    c953027fa91a245e4a273f09c69bd57b.txt
    cd571181bf9b237f4b5fd56a0640ad17.txt
  )

  for required in "${required_files[@]}"; do
    [[ -f "${release_dir}/${required}" ]] || die "release is missing required file: ${required}"
  done

  local js_file
  for js_file in \
    app.js \
    admin_server.js \
    fetch_pv_news.js \
    fetch_prices.js \
    fetch_wechat.js \
    wechat_gateway/server.js \
    wechat_gateway/gateway.js \
    wechat_gateway/storage.js \
    wechat_gateway/platform_client.js \
    wechat_gateway/prototype_sources.js \
    merge.js \
    source_registry.js \
    lib/safe_io.js \
    lib/process_lock.js \
    lib/wechat_run_status.js \
    lib/source_health.js \
    lib/custom_sources.js \
    lib/safe_remote_fetch.js \
    lib/x_sources.js \
    lib/ai_config.js \
    lib/ai_editor.js \
    lib/source_catalog.js \
    lib/seo.js; do
    "${NODE_BIN}" --check "${release_dir}/${js_file}" >/dev/null
  done

  "${NODE_BIN}" - "${release_dir}/data.json" "${release_dir}/site_texts.json" <<'NODE'
const fs = require('fs');
for (const file of process.argv.slice(2)) JSON.parse(fs.readFileSync(file, 'utf8'));
NODE

  if [[ "${verify_dependencies}" == "1" ]]; then
    (
      cd "${release_dir}"
      "${NODE_BIN}" -e "require('puppeteer'); require('qrcode'); require('./lib/safe_io'); require('./lib/process_lock'); require('./lib/x_sources'); require('./wechat_gateway/gateway')"
    )
  fi

  grep -q 'app\.js' "${release_dir}/index.html" \
    || die "index.html does not reference app.js"
  grep -q 'styles\.css' "${release_dir}/index.html" \
    || die "index.html does not reference styles.css"
}

write_release_manifest() {
  local release_dir="$1"
  local sha="$2"
  local artifact_checksum="$3"
  local deployed_at
  deployed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  cat >"${release_dir}/release.json" <<EOF
{"gitSha":"${sha}","artifactSha256":"${artifact_checksum}","deployedAt":"${deployed_at}"}
EOF
  chgrp "${RUNTIME_GROUP}" "${release_dir}/release.json"
  chmod 0640 "${release_dir}/release.json"
}

verify_existing_release() {
  local release_dir="$1"
  local sha="$2"
  local artifact_checksum="$3"

  [[ -f "${release_dir}/release.json" ]] \
    || die "existing release has no release.json: ${release_dir}"
  "${NODE_BIN}" - "${release_dir}/release.json" "${sha}" "${artifact_checksum}" <<'NODE'
const fs = require('fs');
const [manifestPath, expectedSha, expectedArtifact] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.gitSha !== expectedSha) throw new Error('release git SHA mismatch');
if (manifest.artifactSha256 !== expectedArtifact) throw new Error('artifact checksum mismatch for existing release');
NODE
  preflight_release "${release_dir}"
}

smoke_external() {
  local expected_sha="$1"
  local url="${PUBLIC_URL%/}"
  local temporary_dir
  temporary_dir="$(mktemp -d)"
  local curl_options=(
    --fail
    --silent
    --show-error
    --location
    --connect-timeout 5
    --max-time 20
    --retry 2
    --retry-delay 1
    --retry-connrefused
  )

  local smoke_rc=0
  (
    curl "${curl_options[@]}" \
      "${url}/?__pvhot_release=${expected_sha}" \
      -o "${temporary_dir}/index.html" || exit $?
    grep -qi '<html' "${temporary_dir}/index.html" || exit $?
    grep -q 'app\.js' "${temporary_dir}/index.html" || exit $?

    curl "${curl_options[@]}" \
      "${url}/data.json?__pvhot_release=${expected_sha}" \
      -o "${temporary_dir}/data.json" || exit $?
    "${NODE_BIN}" - "${temporary_dir}/data.json" <<'NODE' || exit $?
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!value || !Array.isArray(value.items)) throw new Error('data.json has no items array');
NODE

    curl "${curl_options[@]}" \
      "${url}/api/v1/archive/?__pvhot_release=${expected_sha}" \
      -o "${temporary_dir}/news.html" || exit $?
    grep -q 'PVHOT 光伏新闻归档' "${temporary_dir}/news.html" || exit $?

    curl "${curl_options[@]}" \
      "${url}/api/v1/sitemap.xml?__pvhot_release=${expected_sha}" \
      -o "${temporary_dir}/sitemap.xml" || exit $?
    grep -q '<urlset' "${temporary_dir}/sitemap.xml" || exit $?
    grep -q '/api/v1/articles/' "${temporary_dir}/sitemap.xml" || exit $?

    curl "${curl_options[@]}" \
      "${url}/api/healthz?__pvhot_release=${expected_sha}" \
      -o "${temporary_dir}/health.json" || exit $?
    "${NODE_BIN}" - "${temporary_dir}/health.json" "${expected_sha}" <<'NODE' || exit $?
const fs = require('fs');
const [file, expected] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
const service = value && (value.service || value.svc);
if (!value || value.ok !== true || service !== 'pvhot-admin' || value.release !== expected) {
  throw new Error('admin health check failed');
}
NODE

    # A process can briefly answer before crashing. Require the same release
    # to remain healthy after a short stability window.
    sleep 2
    curl "${curl_options[@]}" \
      "${url}/api/healthz?__pvhot_stable=${expected_sha}" \
      -o "${temporary_dir}/health-stable.json" || exit $?
    "${NODE_BIN}" - "${temporary_dir}/health-stable.json" "${expected_sha}" <<'NODE' || exit $?
const fs = require('fs');
const [file, expected] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
const service = value && (value.service || value.svc);
if (!value || value.ok !== true || service !== 'pvhot-admin' || value.release !== expected) {
  throw new Error('admin stability health check failed');
}
NODE

    curl "${curl_options[@]}" \
      "${url}/release.json?__pvhot_release=${expected_sha}" \
      -o "${temporary_dir}/release.json" || exit $?
    "${NODE_BIN}" - "${temporary_dir}/release.json" "${expected_sha}" <<'NODE' || exit $?
const fs = require('fs');
const [file, expected] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!value || value.gitSha !== expected) throw new Error('public release SHA mismatch');
NODE
  ) || smoke_rc=$?

  rm -rf -- "${temporary_dir}"
  return "${smoke_rc}"
}

restore_links_after_failure() {
  set +e
  if (( ACTIVATED == 1 && COMMITTED == 0 )); then
    log "deployment failed after activation; restoring previous release"
    if [[ -n "${OLD_CURRENT}" ]]; then
      atomic_link "${OLD_CURRENT}" "${CURRENT_LINK}"
    elif [[ -L "${CURRENT_LINK}" ]]; then
      rm -f -- "${CURRENT_LINK}"
    fi

    if [[ -n "${OLD_PREVIOUS}" ]]; then
      atomic_link "${OLD_PREVIOUS}" "${PREVIOUS_LINK}"
    elif [[ -L "${PREVIOUS_LINK}" ]]; then
      rm -f -- "${PREVIOUS_LINK}"
    fi

    restart_admin || log "warning: admin service did not restart during automatic rollback"
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    restore_links_after_failure
  fi
  safe_remove_staging "${STAGING_DIR}"
  exit "${rc}"
}

prune_old_releases() {
  local current previous
  current="$(current_release "${CURRENT_LINK}")"
  previous="$(current_release "${PREVIOUS_LINK}")"
  local kept=0
  local record path normalized

  while IFS= read -r record; do
    path="${record#* }"
    normalized="$(realpath -m -- "${path}")"
    [[ -d "${normalized}" && ! -L "${normalized}" ]] || continue
    [[ "$(basename -- "${normalized}")" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || continue
    validate_release_path "${normalized}"

    if (( kept < KEEP_RELEASES )) || [[ "${normalized}" == "${current}" || "${normalized}" == "${previous}" ]]; then
      kept=$((kept + 1))
      continue
    fi

    log "removing old release $(basename -- "${normalized}")"
    if ! rm -rf -- "${normalized}"; then
      # Pruning is housekeeping after the new release has already passed all
      # health checks. A legacy runtime-owned cache must not turn a healthy
      # production deployment red or trigger an unnecessary rollback.
      log "warning: could not fully remove old release $(basename -- "${normalized}"); leaving it for manual cleanup"
    fi
  done < <(find "${RELEASES_DIR}" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    -printf '%T@ %p\n' | sort -rn)
}

main() {
  (( $# == 2 )) || usage
  local artifact_input="$1"
  local sha="$2"

  require_command realpath
  require_command tar
  require_command sha256sum
  require_command flock
  require_command curl
  require_command find
  require_command sort
  require_command awk
  require_command chgrp
  require_command getent
  require_command stat
  require_command tr
  require_command id
  require_command grep
  require_command ln
  require_command mktemp

  [[ "${NODE_BIN}" == /* && -x "${NODE_BIN}" ]] \
    || die "PVHOT_NODE_BIN must name an executable absolute path"
  [[ "${NPM_BIN}" == /* && -x "${NPM_BIN}" ]] \
    || die "PVHOT_NPM_BIN must name an executable absolute path"

  validate_base_dir
  validate_public_url
  validate_sha "${sha}"
  [[ "${RUNTIME_USER}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] \
    || die "invalid PVHOT_RUNTIME_USER: ${RUNTIME_USER}"
  getent passwd "${RUNTIME_USER}" >/dev/null \
    || die "runtime user does not exist: ${RUNTIME_USER}"
  [[ "${RUNTIME_GROUP}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] \
    || die "invalid PVHOT_RUNTIME_GROUP: ${RUNTIME_GROUP}"
  getent group "${RUNTIME_GROUP}" >/dev/null \
    || die "runtime group does not exist: ${RUNTIME_GROUP}"
  id -Gn | tr ' ' '\n' | grep -Fxq "${RUNTIME_GROUP}" \
    || die "deployment user $(id -un) is not a member of runtime group ${RUNTIME_GROUP}"
  [[ "${SKIP_EXTERNAL_SMOKE}" == "0" || "${SKIP_EXTERNAL_SMOKE}" == "1" ]] \
    || die "PVHOT_SKIP_EXTERNAL_SMOKE must be 0 or 1"
  [[ "${KEEP_RELEASES}" =~ ^[1-9][0-9]*$ ]] \
    || die "PVHOT_KEEP_RELEASES must be a positive integer"

  [[ "${artifact_input}" == /* ]] || die "artifact path must be absolute"
  local artifact
  artifact="$(realpath -e -- "${artifact_input}")"
  [[ -f "${artifact}" && ! -L "${artifact}" ]] || die "artifact must be a regular file"
  case "$(basename -- "${artifact}")" in
    *"${sha}"*.tar.gz|*"${sha}"*.tgz) ;;
    *) die "artifact filename must contain the full git SHA" ;;
  esac

  validate_archive_entries "${artifact}"
  local artifact_checksum
  artifact_checksum="$(sha256sum "${artifact}" | awk '{print $1}')"

  mkdir -p -- "${RELEASES_DIR}" "${SHARED_DIR}"
  chgrp "${RUNTIME_GROUP}" "${RELEASES_DIR}" "${SHARED_DIR}"
  chmod 2750 "${RELEASES_DIR}"
  chmod 2770 "${SHARED_DIR}"
  exec 9>"${BASE_DIR}/.deploy.lock"
  flock -w 120 9 || die "timed out waiting for another deployment"
  trap on_exit EXIT

  local release_dir="${RELEASES_DIR}/${sha}"
  validate_release_path "${release_dir}"

  if [[ -d "${release_dir}" ]]; then
    log "release already exists; verifying idempotent deployment"
    verify_existing_release "${release_dir}" "${sha}" "${artifact_checksum}"
  else
    STAGING_DIR="$(mktemp -d "${RELEASES_DIR}/.staging-${sha}.XXXXXX")"
    tar \
      --extract \
      --gzip \
      --file "${artifact}" \
      --directory "${STAGING_DIR}" \
      --no-same-owner \
      --no-same-permissions

    if [[ -n "$(find "${STAGING_DIR}" -type l -print -quit)" ]]; then
      die "release archives may not contain symbolic links"
    fi
    if [[ -n "$(find "${STAGING_DIR}" \( -type b -o -type c -o -type p -o -type s \) -print -quit)" ]]; then
      die "release archive contains a special filesystem entry"
    fi

    preflight_release "${STAGING_DIR}" 0
    install_dependencies
    initialize_shared_state
    wire_shared_state
    write_release_manifest "${STAGING_DIR}" "${sha}" "${artifact_checksum}"

    find "${STAGING_DIR}" -type d -exec chgrp "${RUNTIME_GROUP}" {} + -exec chmod g+rx,o-rwx {} +
    find "${STAGING_DIR}" -type f -exec chgrp "${RUNTIME_GROUP}" {} + -exec chmod g+r,o-rwx {} +
    preflight_release "${STAGING_DIR}"

    mv -- "${STAGING_DIR}" "${release_dir}"
    STAGING_DIR=""
    log "prepared immutable release ${sha}"
  fi

  # Keep every command in a running fetch/price pipeline on one immutable
  # release. Without this shared lock, `current` could switch between the
  # fetch and merge steps and mix runtime protocols from two versions.
  [[ -d "${SHARED_DIR}/run" && ! -L "${SHARED_DIR}/run" ]] \
    || die "shared pipeline runtime directory is missing or unsafe"
  exec 8>"${SHARED_DIR}/run/.pipeline.lock"
  flock -w 120 8 || die "timed out waiting for the active data pipeline"

  OLD_CURRENT="$(current_release "${CURRENT_LINK}")"
  OLD_PREVIOUS="$(current_release "${PREVIOUS_LINK}")"
  if [[ "${SKIP_EXTERNAL_SMOKE}" == "1" && -n "${OLD_CURRENT}" ]]; then
    die "PVHOT_SKIP_EXTERNAL_SMOKE=1 is allowed only for the first bootstrap with no current release"
  fi
  if [[ "${OLD_CURRENT}" == "${release_dir}" ]]; then
    log "release ${sha} is already active"
    smoke_external "${sha}" || die "external smoke check failed for active release"
    COMMITTED=1
    prune_old_releases
    log "deployment is healthy and unchanged"
    return 0
  fi

  if [[ -n "${OLD_CURRENT}" ]]; then
    atomic_link "${OLD_CURRENT}" "${PREVIOUS_LINK}"
  fi
  atomic_link "${release_dir}" "${CURRENT_LINK}"
  ACTIVATED=1

  restart_admin
  if [[ "${SKIP_EXTERNAL_SMOKE}" == "1" ]]; then
    log "external smoke skipped for first bootstrap only; rerun this release normally after Nginx points to current"
  else
    smoke_external "${sha}" || die "external smoke check failed"
  fi

  COMMITTED=1
  if ! "${NODE_BIN}" "${release_dir}/scripts/submit-indexnow.js"; then
    log "warning: IndexNow notification failed; deployment remains healthy"
  fi
  prune_old_releases
  log "deployed ${sha}; previous=${OLD_CURRENT:-none}; retained=${KEEP_RELEASES}"
}

main "$@"
