import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Check {
  name: string;
  run: () => { ok: boolean; detail: string };
}

export const doctorCommand = new Command('doctor')
  .description('Validate your Mayday Create environment')
  .action(async () => {
    console.log('Mayday Create — Environment Check\n');

    const checks: Check[] = [
      {
        name: 'Node.js >= 20',
        run: () => {
          const version = process.version;
          const major = parseInt(version.slice(1).split('.')[0], 10);
          return { ok: major >= 20, detail: version };
        },
      },
      {
        name: 'npm',
        run: () => {
          try {
            const version = execSync('npm --version', { encoding: 'utf-8' }).trim();
            return { ok: true, detail: `v${version}` };
          } catch {
            return { ok: false, detail: 'not found' };
          }
        },
      },
      {
        name: 'FFmpeg',
        run: () => {
          try {
            const output = execSync('ffmpeg -version', { encoding: 'utf-8' });
            const version = output.split('\n')[0];
            return { ok: true, detail: version };
          } catch {
            return { ok: false, detail: 'not found — install with: brew install ffmpeg' };
          }
        },
      },
      {
        name: 'FFprobe',
        run: () => {
          try {
            execSync('ffprobe -version', { encoding: 'utf-8' });
            return { ok: true, detail: 'available' };
          } catch {
            return { ok: false, detail: 'not found — comes with ffmpeg' };
          }
        },
      },
      {
        name: 'CEP Debug Mode',
        run: () => {
          try {
            const result = execSync('defaults read com.adobe.CSXS.12 PlayerDebugMode', {
              encoding: 'utf-8',
            }).trim();
            return { ok: result === '1', detail: result === '1' ? 'enabled' : `value: ${result}` };
          } catch {
            return { ok: false, detail: 'not set — run: defaults write com.adobe.CSXS.12 PlayerDebugMode 1' };
          }
        },
      },
      {
        name: 'ANTHROPIC_API_KEY',
        run: () => {
          const key = process.env.ANTHROPIC_API_KEY;
          if (key && key.startsWith('sk-ant-')) {
            return { ok: true, detail: `${key.slice(0, 12)}...` };
          }
          return { ok: !key, detail: key ? 'invalid format' : 'not set (optional — needed for AI features)' };
        },
      },
      {
        name: 'Plugins directory',
        run: () => {
          const dir = path.resolve('plugins');
          const exists = fs.existsSync(dir);
          if (!exists) return { ok: false, detail: 'not found' };
          const plugins = fs.readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'mayday.json')));
          return { ok: true, detail: `${plugins.length} plugin(s)` };
        },
      },
      {
        name: 'CEP Extension',
        run: () => {
          const extDir = '/Library/Application Support/Adobe/CEP/extensions/com.mayday.create';
          if (fs.existsSync(extDir)) {
            const isSymlink = fs.lstatSync(extDir).isSymbolicLink();
            return { ok: true, detail: isSymlink ? 'symlinked' : 'installed' };
          }
          return { ok: false, detail: 'not installed — run: mayday install' };
        },
      },
    ];

    let allOk = true;
    for (const check of checks) {
      const result = check.run();
      const icon = result.ok ? '✓' : '✗';
      console.log(`  ${icon} ${check.name}: ${result.detail}`);
      if (!result.ok && check.name !== 'ANTHROPIC_API_KEY' && check.name !== 'CEP Extension') {
        allOk = false;
      }
    }

    console.log(allOk ? '\nAll checks passed!' : '\nSome checks failed. Fix the issues above.');
  });
