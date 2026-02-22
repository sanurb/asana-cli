#!/usr/bin/env bash
# asana-cli installer
# curl -fsSL https://raw.githubusercontent.com/sanurb/asana-cli/main/install.sh | bash
set -euo pipefail

REPO="sanurb/asana-cli"
INSTALL_DIR="${ASANA_CLI_DIR:-/usr/local/bin}"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) OS="darwin" ;;
  linux)  OS="linux" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

BINARY="asana-cli-${OS}-${ARCH}"
echo "Installing asana-cli for ${OS}/${ARCH}..."

# Get latest release URL
DOWNLOAD_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url.*${BINARY}" \
  | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: No binary found for ${OS}/${ARCH}" >&2
  echo "Available at: https://github.com/${REPO}/releases" >&2
  exit 1
fi

# Download
TMP=$(mktemp)
echo "Downloading ${DOWNLOAD_URL}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP"
chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "${INSTALL_DIR}/asana-cli"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "$TMP" "${INSTALL_DIR}/asana-cli"
fi

echo ""
echo "✓ asana-cli installed to ${INSTALL_DIR}/asana-cli"
echo ""
echo "Set your API token:"
echo "  export ASANA_API_TOKEN=<token from https://app.asana.com/app/settings/integrations/developer>"
echo ""
echo "Or use agent-secrets:"
echo "  secrets add ASANA_api_token"
echo ""
echo "Verify:"
echo "  asana-cli help"
