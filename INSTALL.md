# MaydayCreate — Install Instructions

## Prerequisites

- macOS
- Adobe Premiere Pro (with CEP extension support)
- Node.js (v18+)

If Node.js is not installed:

```bash
# Install Homebrew (if needed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node
```

## Setup on a New Machine

1. Plug in the SSD and open a terminal.

2. Rebuild native modules for this machine's architecture:

```bash
cd /Volumes/Finished/MaydayCreate
npm rebuild
```

3. Install the CEP extension (requires admin password):

```bash
npm run install:cep
```

4. Restart Premiere Pro, then open: **Window → Extensions → Mayday Create**

## Starting the Server

```bash
cd /Volumes/Finished/MaydayCreate
npm run dev
```

The server runs on `http://localhost:3000`. The CEP panel connects to it automatically.

## Notes

- `npm rebuild` recompiles native modules (e.g. `better-sqlite3`) for the target CPU architecture. This is required when moving between Intel and Apple Silicon Macs.
- The install script creates a symlink from Adobe's extensions folder to `dist/cep/` on the SSD. If the SSD is disconnected, the extension will not load.
- All project data (source code, dependencies, build output, SQLite databases) lives on the SSD.
