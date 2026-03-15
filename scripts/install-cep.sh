#!/bin/bash
set -e

CEP_DIR="/Library/Application Support/Adobe/CEP/extensions"
EXTENSION_ID="com.mayday.create"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_CEP="$PROJECT_DIR/dist/cep"

echo "Mayday Create — CEP Extension Installer"
echo ""

# Check dist exists
if [ ! -d "$DIST_CEP" ]; then
  echo "Error: dist/cep not found. Run 'npm run build' first."
  exit 1
fi

# Build ExtendScript
echo "Building ExtendScript..."
cd "$PROJECT_DIR"
node packages/extendscript/build.js

# Create target directory if needed
if [ ! -d "$CEP_DIR" ]; then
  echo "Creating CEP extensions directory..."
  sudo mkdir -p "$CEP_DIR"
fi

# Remove existing
TARGET="$CEP_DIR/$EXTENSION_ID"
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  echo "Removing existing extension..."
  sudo rm -rf "$TARGET"
fi

# Symlink
echo "Creating symlink..."
sudo ln -s "$DIST_CEP" "$TARGET"
echo "Linked: $DIST_CEP → $TARGET"

# Enable debug mode
echo "Enabling CEP debug mode..."
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

echo ""
echo "Installation complete!"
echo "Restart Premiere Pro, then open: Window → Extensions → Mayday Create"
