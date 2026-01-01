#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICON_SRC="${ROOT_DIR}/desktop/src-tauri/icons/shard.icon"
OUT_DIR="${ROOT_DIR}/desktop/src-tauri/icons/.compiled-icon"
ASSETS_CAR="${ROOT_DIR}/desktop/src-tauri/icons/Assets.car"

if [[ -f "${ASSETS_CAR}" && ( "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ) ]]; then
  echo "Liquid Glass icon already compiled; using ${ASSETS_CAR}"
  exit 0
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found (Xcode command line tools required)" >&2
  exit 1
fi

if [ ! -d "${ICON_SRC}" ]; then
  echo "error: icon composer file not found at ${ICON_SRC}" >&2
  exit 1
fi

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

xcrun actool "${ICON_SRC}" \
  --compile "${OUT_DIR}" \
  --platform macosx \
  --minimum-deployment-target 10.15 \
  --app-icon shard \
  --output-partial-info-plist "${OUT_DIR}/partial-info.plist"

if [ ! -f "${OUT_DIR}/Assets.car" ]; then
  echo "error: Assets.car not generated (actool failed)" >&2
  exit 1
fi

cp "${OUT_DIR}/Assets.car" "${ASSETS_CAR}"
echo "Liquid Glass icon compiled: ${ASSETS_CAR}"
