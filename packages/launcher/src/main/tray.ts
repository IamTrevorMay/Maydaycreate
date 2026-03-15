import { Tray, Menu, app, nativeImage } from 'electron';
import path from 'path';
import type { BrowserWindow } from 'electron';

let tray: Tray | null = null;

export function createTray(win: BrowserWindow): void {
  // Use a simple template icon; in production replace with real asset
  const iconPath = path.join(__dirname, '../../resources/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Mayday Create');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        win.show();
        win.focus();
      },
    },
    {
      label: 'Sync Now',
      click: () => {
        win.webContents.send('tray:sync');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
