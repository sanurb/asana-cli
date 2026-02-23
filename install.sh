#!/usr/bin/env bash
# asana-cli installer
# curl -fsSL https://raw.githubusercontent.com/sanurb/asana-cli/main/install.sh | bash
set -euo pipefail

REPO="sanurb/asana-cli"
GITHUB="${GITHUB:-https://github.com}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"

# ── Colors (only when stdout is a terminal) ─────────────────────────

Color_Off='' Red='' Green='' Dim='' Bold_White='' Bold_Green=''

if [[ -t 1 ]]; then
  Color_Off='\033[0m'
  Red='\033[0;31m'
  Green='\033[0;32m'
  Dim='\033[0;2m'
  Bold_Green='\033[1;32m'
  Bold_White='\033[1m'
fi

error()     { echo -e "${Red}error${Color_Off}: $*" >&2; exit 1; }
info()      { echo -e "${Dim}$*${Color_Off}"; }
info_bold() { echo -e "${Bold_White}$*${Color_Off}"; }
success()   { echo -e "${Green}$*${Color_Off}"; }

# ── Dependency check ────────────────────────────────────────────────

command -v curl >/dev/null || error 'curl is required to install asana-cli'

# ── Platform detection ──────────────────────────────────────────────

platform="$(uname -ms)"

case "$platform" in
  'Darwin x86_64')  target=darwin-x64   ;;
  'Darwin arm64')   target=darwin-arm64  ;;
  'Linux x86_64')   target=linux-x64    ;;
  'Linux aarch64')  target=linux-arm64  ;;
  'Linux arm64')    target=linux-arm64  ;;
  *) error "Unsupported platform: ${platform}. asana-cli supports macOS (x64/arm64) and Linux (x64/arm64)." ;;
esac

# Rosetta detection — prefer native arm64 binary
if [[ $target = darwin-x64 ]]; then
  if [[ $(sysctl -n sysctl.proc_translated 2>/dev/null) = 1 ]]; then
    target=darwin-arm64
    info "Rosetta 2 detected. Installing native arm64 binary instead."
  fi
fi

binary="asana-cli-${target}"

# ── Install directory ───────────────────────────────────────────────

install_dir="${ASANA_CLI_DIR:-/usr/local/bin}"
exe="${install_dir}/asana-cli"

if [[ ! -d "$install_dir" ]]; then
  mkdir -p "$install_dir" 2>/dev/null || sudo mkdir -p "$install_dir" ||
    error "Failed to create install directory: ${install_dir}"
fi

# ── Resolve download URL ────────────────────────────────────────────

info "Resolving latest release for ${target}..."

if [[ ${1:-} =~ ^v ]]; then
  tag="$1"
  download_url="${GITHUB}/${REPO}/releases/download/${tag}/${binary}"
else
  download_url=$(
    curl -fsSL "${GITHUB_API}/repos/${REPO}/releases/latest" \
      | grep "browser_download_url.*${binary}" \
      | cut -d '"' -f 4
  ) || true
fi

if [[ -z "${download_url:-}" ]]; then
  error "No binary found for ${target}.\n  Check available releases: ${GITHUB}/${REPO}/releases"
fi

# ── Download & install ──────────────────────────────────────────────

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

info "Downloading ${download_url}..."
curl --fail --location --progress-bar --output "$tmp" "$download_url" ||
  error "Download failed. URL: ${download_url}"

chmod +x "$tmp"

if [[ -w "$install_dir" ]]; then
  mv "$tmp" "$exe"
else
  info "Installing to ${install_dir} (requires sudo)..."
  sudo mv "$tmp" "$exe" || error "Failed to install to ${install_dir}"
fi

# ── Verify ──────────────────────────────────────────────────────────

tildify() {
  if [[ $1 = "$HOME"/* ]]; then
    echo "~${1#"$HOME"}"
  else
    echo "$1"
  fi
}

echo
success "asana-cli was installed successfully to ${Bold_Green}$(tildify "$exe")"

if command -v asana-cli >/dev/null; then
  echo
  info "Run 'asana-cli help' to get started."
  exit 0
fi

# ── PATH setup guidance ─────────────────────────────────────────────

tilde_dir="$(tildify "$install_dir")"

echo
case "$(basename "${SHELL:-}")" in
  fish)
    info "Add to your PATH in ~/.config/fish/config.fish:"
    info_bold "  fish_add_path ${tilde_dir}"
    ;;
  zsh)
    info "Add to your PATH in ~/.zshrc:"
    info_bold "  export PATH=\"${tilde_dir}:\$PATH\""
    ;;
  bash)
    info "Add to your PATH in ~/.bashrc:"
    info_bold "  export PATH=\"${tilde_dir}:\$PATH\""
    ;;
  *)
    info "Add to your PATH:"
    info_bold "  export PATH=\"${tilde_dir}:\$PATH\""
    ;;
esac

echo
info "Then configure your Asana token:"
info_bold "  export ASANA_ACCESS_TOKEN=\"0/your-token-here\""
echo
info "Create a token at: ${Bold_White}https://app.asana.com/0/developer-console"
echo
info "Or use agent-secrets:"
info_bold "  secrets add asana_access_token"
echo
info "Verify installation:"
info_bold "  asana-cli help"
