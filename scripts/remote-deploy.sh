#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 3 ]]; then
  printf '[pvhot-ci] usage: remote-deploy.sh <git-sha> <run-id> <run-attempt>\n' >&2
  exit 2
fi

readonly GIT_SHA="$1"
readonly RUN_ID="$2"
readonly RUN_ATTEMPT="$3"
readonly INCOMING_DIR="/var/www/pvhot/incoming"

[[ "${GIT_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
  printf '[pvhot-ci] invalid Git SHA\n' >&2
  exit 2
}
[[ "${RUN_ID}" =~ ^[0-9]+$ && "${RUN_ATTEMPT}" =~ ^[0-9]+$ ]] || {
  printf '[pvhot-ci] invalid GitHub run identity\n' >&2
  exit 2
}

readonly UPLOAD_STEM="${INCOMING_DIR}/.pvhot-${GIT_SHA}.${RUN_ID}.${RUN_ATTEMPT}"
readonly UPLOAD_PART="${UPLOAD_STEM}.tar.gz.part"
readonly CHECKSUM_PART="${UPLOAD_STEM}.sha256.part"
readonly ARTIFACT="${INCOMING_DIR}/pvhot-${GIT_SHA}.tar.gz"
readonly CHECKSUM="${ARTIFACT}.sha256"

cleanup() {
  rm -f -- "${UPLOAD_PART}" "${CHECKSUM_PART}" "${ARTIFACT}" "${CHECKSUM}"
}
trap cleanup EXIT

umask 027
[[ -d "${INCOMING_DIR}" ]] || {
  printf '[pvhot-ci] incoming directory is not provisioned\n' >&2
  exit 1
}
[[ -f "${UPLOAD_PART}" && ! -L "${UPLOAD_PART}" ]] || {
  printf '[pvhot-ci] uploaded artifact is missing or unsafe\n' >&2
  exit 1
}
[[ -f "${CHECKSUM_PART}" && ! -L "${CHECKSUM_PART}" ]] || {
  printf '[pvhot-ci] uploaded checksum is missing or unsafe\n' >&2
  exit 1
}

expected_checksum="$(awk 'NR == 1 { print $1 }' "${CHECKSUM_PART}")"
[[ "${expected_checksum}" =~ ^[0-9a-f]{64}$ ]] || {
  printf '[pvhot-ci] checksum sidecar is invalid\n' >&2
  exit 1
}
actual_checksum="$(sha256sum "${UPLOAD_PART}" | awk '{ print $1 }')"
[[ "${actual_checksum}" == "${expected_checksum}" ]] || {
  printf '[pvhot-ci] uploaded artifact checksum mismatch\n' >&2
  exit 1
}

mv -- "${UPLOAD_PART}" "${ARTIFACT}"
mv -- "${CHECKSUM_PART}" "${CHECKSUM}"
(
  cd "${INCOMING_DIR}"
  sha256sum --check --status "$(basename -- "${CHECKSUM}")"
)

printf '[pvhot-ci] artifact verified; activating %s\n' "${GIT_SHA}"
/usr/local/bin/pvhot-deploy "${ARTIFACT}" "${GIT_SHA}"
printf '[pvhot-ci] deployment completed for %s\n' "${GIT_SHA}"
