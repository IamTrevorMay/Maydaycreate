#!/bin/bash
set -e

CEP_DIR="/Library/Application Support/Adobe/CEP/extensions"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Mayday — CEP Extension Installer"
echo ""

# ── Build ────────────────────────────────────────────────────────────────────

# Build ExtendScript (shared between core and panel)
echo "Building ExtendScript..."
cd "$PROJECT_DIR"
node packages/extendscript/build.js

# Build Mayday Core CEP extension
echo "Building Mayday Core..."
node packages/cep-core/build.js

# ── Check dist ───────────────────────────────────────────────────────────────

DIST_CEP="$PROJECT_DIR/dist/cep"
DIST_CORE="$PROJECT_DIR/dist/cep-core"

if [ ! -d "$DIST_CEP" ]; then
  echo "Error: dist/cep not found. Run 'npm run build:cep' first."
  exit 1
fi

if [ ! -d "$DIST_CORE" ]; then
  echo "Error: dist/cep-core not found. Build failed."
  exit 1
fi

# Create target directory if needed
if [ ! -d "$CEP_DIR" ]; then
  echo "Creating CEP extensions directory..."
  sudo mkdir -p "$CEP_DIR"
fi

# ── Install Mayday Core (com.mayday.core) ────────────────────────────────────

CORE_ID="com.mayday.core"
CORE_TARGET="$CEP_DIR/$CORE_ID"

if [ -e "$CORE_TARGET" ] || [ -L "$CORE_TARGET" ]; then
  echo "Removing existing Mayday Core extension..."
  sudo rm -rf "$CORE_TARGET"
fi

echo "Creating symlink for Mayday Core..."
sudo ln -s "$DIST_CORE" "$CORE_TARGET"
echo "  Linked: $DIST_CORE → $CORE_TARGET"

# ── Install Mayday Create (com.mayday.create) ───────────────────────────────

PANEL_ID="com.mayday.create"
PANEL_TARGET="$CEP_DIR/$PANEL_ID"

if [ -e "$PANEL_TARGET" ] || [ -L "$PANEL_TARGET" ]; then
  echo "Removing existing Mayday Create extension..."
  sudo rm -rf "$PANEL_TARGET"
fi

echo "Creating symlink for Mayday Create..."
sudo ln -s "$DIST_CEP" "$PANEL_TARGET"
echo "  Linked: $DIST_CEP → $PANEL_TARGET"

# ── Enable debug mode ────────────────────────────────────────────────────────

echo "Enabling CEP debug mode..."
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

echo ""
echo "Installation complete!"
echo "Restart Premiere Pro, then open:"
echo "  Window → Extensions → Mayday Core    (bridge panel)"
echo "  Window → Extensions → Mayday Create  (main panel)"
