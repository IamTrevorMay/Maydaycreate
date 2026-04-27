# Mayday PLUGIN_NAME

PLUGIN_DESCRIPTION

## Installation

Install via Mayday's Plugin Manager (in the launcher app):
1. Open Mayday Create launcher
2. Go to Plugin Manager
3. Find "PLUGIN_NAME" in Available plugins
4. Click Install

## Development

```bash
# Install dependencies
npm install

# Build plugin
npm run build

# Package as zip for release
npm run package
```

## Release

Tag a version to trigger the GitHub Action:

```bash
git tag v1.0.0
git push --tags
```

The GitHub Action will build, package, and create a GitHub Release with the zip asset. Mayday's Plugin Manager will automatically detect the new version.
