#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="${HOME}/.local/bin"
target="${bin_dir}/openclaw-proxy-hotfix"

mkdir -p "${bin_dir}"
chmod +x "${repo_dir}/bin/openclaw-proxy-hotfix.mjs"
ln -sfn "${repo_dir}/bin/openclaw-proxy-hotfix.mjs" "${target}"

echo "installed: ${target}"
echo "try: openclaw-proxy-hotfix check"
