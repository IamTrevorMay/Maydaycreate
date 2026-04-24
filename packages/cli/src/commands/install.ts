import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CEP_EXTENSIONS_DIR = '/Library/Application Support/Adobe/CEP/extensions';
const EXTENSION_ID = 'com.mayday.create';

export const installCommand = new Command('install')
  .description('Install/symlink CEP extension to Adobe extensions folder')
  .action(async () => {
    const distCep = path.resolve('dist/cep');
    const targetDir = path.join(CEP_EXTENSIONS_DIR, EXTENSION_ID);

    if (!fs.existsSync(distCep)) {
      console.error('dist/cep not found. Run `mayday build` first.');
      process.exit(1);
    }

    // Remove existing symlink or directory (lstatSync detects broken symlinks too)
    let targetExists = false;
    try { targetExists = fs.lstatSync(targetDir).isSymbolicLink() || fs.existsSync(targetDir); } catch { /* ENOENT — doesn't exist */ }
    if (targetExists) {
      console.log(`Removing existing: ${targetDir}`);
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Create symlink
    try {
      fs.symlinkSync(distCep, targetDir, 'dir');
      console.log(`Symlinked: ${distCep} → ${targetDir}`);
    } catch (err) {
      console.error('Failed to create symlink. Try running with sudo:');
      console.error(`  sudo mayday install`);
      process.exit(1);
    }

    // Enable CEP debug mode
    try {
      execSync('defaults write com.adobe.CSXS.12 PlayerDebugMode 1');
      console.log('CEP debug mode enabled');
    } catch {
      console.log('Note: Could not set CEP debug mode. Run manually:');
      console.log('  defaults write com.adobe.CSXS.12 PlayerDebugMode 1');
    }

    console.log('\nInstallation complete! Restart Premiere Pro to load the extension.');
    console.log('Open: Window → Extensions → Mayday Create');
  });
