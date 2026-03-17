import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EXCALIBUR_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Knights of the Editing Table',
  'excalibur',
);
const CMDLIST_PATH = path.join(EXCALIBUR_DIR, '.cmdlist.json');
const MAYDAY_PORT = 9876;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandSettings {
  commandId?: string;
  commandName?: string;
}

interface ExcaliburCommand {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
}

// ---------------------------------------------------------------------------
// Read commands
// ---------------------------------------------------------------------------

function readExcaliburCommands(): ExcaliburCommand[] {
  try {
    if (!fs.existsSync(CMDLIST_PATH)) return [];

    const cmdlist = JSON.parse(fs.readFileSync(CMDLIST_PATH, 'utf-8')) as Record<
      string,
      Record<string, { show?: number }>
    >;

    const commands: ExcaliburCommand[] = [];
    const userEntries = cmdlist['us'] ?? {};

    for (const [name, cmd] of Object.entries(userEntries)) {
      if (cmd.show !== 1) continue;
      commands.push({
        id: `us:${name}`,
        name,
        category: 'us',
        categoryLabel: 'User Commands',
      });
    }

    return commands;
  } catch (err) {
    streamDeck.logger.error('Failed to read Excalibur commands:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Execute command via Mayday server
// ---------------------------------------------------------------------------

function executeCommand(commandName: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ commandName });

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: MAYDAY_PORT,
        path: '/api/excalibur/execute',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch {
            resolve({ success: false, error: `Bad response: ${data.slice(0, 200)}` });
          }
        });
      },
    );

    req.on('error', (err: Error) => {
      resolve({ success: false, error: `Connection failed: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timed out' });
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

class ExcaliburCommandAction extends SingletonAction {
  override readonly manifestId = 'com.mayday.excalibur.command';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onWillAppear(ev: any): void {
    const settings = ev.payload.settings as CommandSettings;
    if (settings.commandName) {
      ev.action.setTitle(settings.commandName);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async onKeyDown(ev: any): Promise<void> {
    const settings = ev.payload.settings as CommandSettings;

    if (!settings.commandName) {
      await ev.action.showAlert();
      return;
    }

    try {
      const result = await executeCommand(settings.commandName);
      if (result.success) {
        await ev.action.showOk();
      } else {
        streamDeck.logger.error(`Command "${settings.commandName}" failed: ${result.error}`);
        await ev.action.showAlert();
      }
    } catch (err) {
      streamDeck.logger.error('Execute failed:', err);
      await ev.action.showAlert();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onDidReceiveSettings(ev: any): void {
    const settings = ev.payload.settings as CommandSettings;
    if (settings.commandName) {
      ev.action.setTitle(settings.commandName);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onSendToPlugin(ev: any): void {
    const payload = ev.payload as { event?: string };

    if (payload.event === 'getCommands') {
      const commands = readExcaliburCommands();
      streamDeck.ui.sendToPropertyInspector({ event: 'commands', commands });
    }
  }
}

// ---------------------------------------------------------------------------
// Register & connect
// ---------------------------------------------------------------------------

streamDeck.actions.registerAction(new ExcaliburCommandAction());
streamDeck.connect();
