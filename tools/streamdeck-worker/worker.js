#!/usr/bin/env node

/**
 * Stream Deck Worker Process
 *
 * Runs as a standalone child process using the system Node.js binary.
 * Communicates with the parent (Electron server) via newline-delimited JSON
 * over stdin/stdout.
 *
 * This process loads @elgato-stream-deck/node which depends on node-hid —
 * a native addon that SIGSEGV's inside Electron's runtime. By running in a
 * separate process we avoid the crash entirely.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

let streamDeckLib = null;
let canvasLib = null;
let openDevice = null;
let devicePath = null;

// ── Messaging helpers ────────────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResponse(id, data) {
  send({ id, type: 'response', ...data });
}

function sendEvent(type, data) {
  send({ type, ...data });
}

// ── Command handlers ─────────────────────────────────────────────────────────

async function handleListDevices(id) {
  try {
    const devices = await streamDeckLib.listStreamDecks();
    sendResponse(id, {
      success: true,
      devices: devices.map(d => ({
        path: d.path,
        model: d.model?.toString() ?? 'unknown',
        serialNumber: d.serialNumber ?? null,
      })),
    });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

async function handleOpenDevice(id, path) {
  try {
    if (openDevice) {
      try { await openDevice.close(); } catch {}
      openDevice = null;
      devicePath = null;
    }

    openDevice = await streamDeckLib.openStreamDeck(path);
    devicePath = path;

    // Forward button events
    openDevice.on('down', (keyIndex) => {
      sendEvent('device:down', { slot: keyIndex });
    });

    openDevice.on('up', (keyIndex) => {
      sendEvent('device:up', { slot: keyIndex });
    });

    openDevice.on('error', (err) => {
      sendEvent('device:error', { error: err.message });
      openDevice = null;
      devicePath = null;
    });

    const serial = await openDevice.getSerialNumber().catch(() => null);
    const firmware = await openDevice.getFirmwareVersion().catch(() => null);

    sendResponse(id, {
      success: true,
      serialNumber: serial,
      firmwareVersion: firmware,
      model: openDevice.MODEL?.toString() ?? 'unknown',
    });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

async function handleCloseDevice(id) {
  try {
    if (openDevice) {
      await openDevice.close();
      openDevice = null;
      devicePath = null;
    }
    sendResponse(id, { success: true });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

async function handleFillColor(id, { slot, r, g, b }) {
  try {
    if (!openDevice) throw new Error('No device open');
    await openDevice.fillKeyColor(slot, r, g, b);
    sendResponse(id, { success: true });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

async function handleFillImage(id, { slot, buffer }) {
  try {
    if (!openDevice) throw new Error('No device open');
    await openDevice.fillKeyBuffer(slot, Buffer.from(buffer, 'base64'));
    sendResponse(id, { success: true });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

async function handleSetBrightness(id, { brightness }) {
  try {
    if (!openDevice) throw new Error('No device open');
    await openDevice.setBrightness(brightness);
    sendResponse(id, { success: true });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

async function handleFillText(id, { slot, label, bgR, bgG, bgB, fgR, fgG, fgB }) {
  try {
    if (!openDevice) throw new Error('No device open');

    if (!canvasLib) {
      // Fallback to solid color if canvas not available
      await openDevice.fillKeyColor(slot, bgR ?? 40, bgG ?? 40, bgB ?? 40);
      sendResponse(id, { success: true });
      return;
    }

    const size = 72;
    const canvas = canvasLib.createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = `rgb(${bgR ?? 51}, ${bgG ?? 51}, ${bgB ?? 51})`;
    ctx.fillRect(0, 0, size, size);

    // Text
    ctx.fillStyle = `rgb(${fgR ?? 255}, ${fgG ?? 255}, ${fgB ?? 255})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const fontSize = label.length > 12 ? 10 : label.length > 8 ? 12 : 14;
    ctx.font = `bold ${fontSize}px sans-serif`;

    // Word wrap for long labels
    const words = label.split(/[\s-]+/);
    if (words.length > 1 && label.length > 8) {
      const mid = Math.ceil(words.length / 2);
      const line1 = words.slice(0, mid).join(' ');
      const line2 = words.slice(mid).join(' ');
      ctx.fillText(line1, size / 2, size / 2 - fontSize * 0.6, size - 8);
      ctx.fillText(line2, size / 2, size / 2 + fontSize * 0.6, size - 8);
    } else {
      ctx.fillText(label, size / 2, size / 2, size - 8);
    }

    // Convert RGBA → RGB for Stream Deck
    const imageData = ctx.getImageData(0, 0, size, size);
    const rgbBuffer = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      rgbBuffer[i * 3] = imageData.data[i * 4];
      rgbBuffer[i * 3 + 1] = imageData.data[i * 4 + 1];
      rgbBuffer[i * 3 + 2] = imageData.data[i * 4 + 2];
    }

    await openDevice.fillKeyBuffer(slot, rgbBuffer);
    sendResponse(id, { success: true });
  } catch (err) {
    sendResponse(id, { success: false, error: err.message });
  }
}

// ── Message router ───────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, type } = msg;

  switch (type) {
    case 'list-devices':
      return handleListDevices(id);
    case 'open-device':
      return handleOpenDevice(id, msg.path);
    case 'close-device':
      return handleCloseDevice(id);
    case 'fill-color':
      return handleFillColor(id, msg);
    case 'fill-image':
      return handleFillImage(id, msg);
    case 'set-brightness':
      return handleSetBrightness(id, msg);
    case 'fill-text':
      return handleFillText(id, msg);
    default:
      sendResponse(id, { success: false, error: `Unknown message type: ${type}` });
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  // Load the native Stream Deck library
  try {
    streamDeckLib = await import('@elgato-stream-deck/node');
  } catch (err) {
    send({ type: 'error', error: `Failed to load @elgato-stream-deck/node: ${err.message}` });
    process.exit(1);
  }

  // Load optional canvas library for text rendering
  try {
    canvasLib = await import('@napi-rs/canvas');
  } catch {
    // Canvas not available — will use solid colors only
  }

  send({ type: 'ready' });

  // Read newline-delimited JSON from stdin
  const rl = createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      await handleMessage(msg);
    } catch (err) {
      send({ type: 'error', error: `Parse error: ${err.message}` });
    }
  });

  rl.on('close', async () => {
    // Parent closed stdin — clean up and exit
    if (openDevice) {
      try { await openDevice.close(); } catch {}
    }
    process.exit(0);
  });
}

main().catch(err => {
  send({ type: 'error', error: err.message });
  process.exit(1);
});
