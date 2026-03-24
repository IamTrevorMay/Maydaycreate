import { app, protocol, net } from 'electron';
import path from 'path';
import { is } from '@electron-toolkit/utils';
import { pathToFileURL } from 'url';

/**
 * Register the `mayday-plugin://` custom protocol.
 *
 * URLs map as:
 *   mayday-plugin://<plugin-id>/<path>
 *   → <pluginsDir>/<plugin-id>/<path>
 *
 * Must be called before app.whenReady() (scheme registration)
 * AND after app.whenReady() (handler registration).
 */

const SCHEME = 'mayday-plugin';

/** Call once at startup, BEFORE app.whenReady() */
export function registerPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Call once AFTER app.whenReady() */
export function registerPluginProtocolHandler(): void {
  const pluginsDir = is.dev
    ? path.resolve(app.getAppPath(), '../../plugins')
    : path.join(process.resourcesPath, 'plugins');

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    // url.hostname = plugin-id, url.pathname = /path/to/file
    const pluginId = url.hostname;
    const filePath = decodeURIComponent(url.pathname);

    // Prevent path traversal
    const resolved = path.resolve(pluginsDir, pluginId, filePath.replace(/^\//, ''));
    const pluginRoot = path.resolve(pluginsDir, pluginId);
    if (!resolved.startsWith(pluginRoot)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Serve the file via net.fetch (handles mime types automatically)
    return net.fetch(pathToFileURL(resolved).href);
  });
}
