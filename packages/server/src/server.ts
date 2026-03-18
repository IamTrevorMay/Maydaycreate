import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import type { BridgeMessage, ServerStatusPayload } from '@mayday/types';
import { BridgeHandler } from './bridge/handler.js';
import { PluginLoader } from './plugins/loader.js';
import { PluginLifecycle } from './plugins/lifecycle.js';
import { PluginRegistry } from './plugins/registry.js';
import { EventBus } from './events/bus.js';
import { TimelineService } from './services/timeline.js';
import { AIService } from './services/ai.js';
import { MediaService } from './services/media.js';
import { EffectsService } from './services/effects.js';
import { HotkeyService } from './services/hotkeys.js';
import { SupabaseSyncService } from './services/supabase-sync.js';
import { executeExcaliburCommand, readExcaliburCommands } from './services/excalibur-executor.js';
import { StreamDeckConfigService } from './services/streamdeck-config.js';
import { StreamDeckHardwareService } from './services/streamdeck-hardware.js';

export interface ServerConfig {
  port: number;
  pluginsDir: string;
  dataDir: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  machineId?: string;
  machineName?: string;
}

export async function startServer(config: ServerConfig) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const startTime = Date.now();

  // Core services
  const eventBus = new EventBus();
  const bridge = new BridgeHandler();
  const registry = new PluginRegistry(config.dataDir);

  // Plugin services
  const timelineService = new TimelineService(bridge);
  const aiService = new AIService();
  const mediaService = new MediaService();
  const effectsService = new EffectsService(bridge);

  // Global hotkeys for boost (works even when Premiere has focus)
  const hotkeyService = new HotkeyService();
  await hotkeyService.start();

  // Track current pending record for boost hotkey
  let pendingBoostRecordId: number | null = null;

  // When a feedback request arrives, activate boost hotkey for non-undo edits
  eventBus.on('plugin:cutting-board:feedback-request', (event) => {
    const data = event.data as { recordId: number; isUndo: boolean };
    if (data.isUndo) return;
    if (event.source === 'panel') return;

    pendingBoostRecordId = data.recordId;

    hotkeyService.setActive(() => {
      if (pendingBoostRecordId == null) return;
      const recordId = pendingBoostRecordId;
      pendingBoostRecordId = null;

      eventBus.emit('plugin:cutting-board:boost', 'hotkey', { recordId });
      bridge.sendToPanel({
        id: uuid(),
        type: 'plugin:cutting-board:hotkey-boost' as import('@mayday/types').BridgeMessageType,
        payload: { recordId },
        timestamp: Date.now(),
      });

      console.log(`[Hotkeys] Boost for record ${recordId}`);
    });
  });

  // Plugin system
  const lifecycle = new PluginLifecycle(
    { timeline: timelineService, ai: aiService, media: mediaService, effects: effectsService },
    eventBus,
    registry,
    config.dataDir
  );
  const loader = new PluginLoader(config.pluginsDir, lifecycle, eventBus);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Date.now() - startTime,
      plugins: lifecycle.getActivePlugins().length,
    });
  });

  // Plugin API
  app.get('/api/plugins', (_req, res) => {
    res.json(lifecycle.getAllPlugins());
  });

  app.use(express.json());

  app.post('/api/plugins/:id/command/:command', async (req, res) => {
    try {
      const result = await lifecycle.executeCommand(
        req.params.id,
        req.params.command,
        req.body
      );
      res.json({ success: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Mayday] Command error ${req.params.id}/${req.params.command}:`, message);
      res.status(400).json({ success: false, error: message });
    }
  });

  app.post('/api/plugins/:id/enable', async (req, res) => {
    try {
      await lifecycle.activatePlugin(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/plugins/:id/disable', async (req, res) => {
    try {
      await lifecycle.deactivatePlugin(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: String(err) });
    }
  });

  // ── Excalibur Stream Deck integration ─────────────────────────────────────

  app.post('/api/excalibur/execute', async (req, res) => {
    const { commandName } = req.body as { commandName?: string };
    if (!commandName) {
      res.status(400).json({ success: false, error: 'Missing commandName' });
      return;
    }

    try {
      const result = await executeExcaliburCommand(commandName, bridge);
      if (!result.success) {
        const status = result.error?.includes('not connected') ? 503
          : result.error?.includes('not found') ? 404
          : result.error?.includes('No clip') ? 400
          : 500;
        res.status(status).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Excalibur] Execute error:`, message);
      res.status(500).json({ success: false, error: message });
    }
  });

  // ── Stream Deck config + hardware ──────────────────────────────────────────
  const streamDeckConfig = new StreamDeckConfigService(config.dataDir);
  const streamDeckHardware = new StreamDeckHardwareService(streamDeckConfig, bridge);
  streamDeckHardware.start().catch(err => {
    console.error('[StreamDeck] Hardware start error:', err);
  });

  app.get('/api/streamdeck/config', (_req, res) => {
    res.json({ success: true, config: streamDeckConfig.getConfig() });
  });

  app.post('/api/streamdeck/config', (req, res) => {
    try {
      streamDeckConfig.save(req.body);
      res.json({ success: true, config: streamDeckConfig.getConfig() });
    } catch (err) {
      res.status(400).json({ success: false, error: String(err) });
    }
  });

  app.get('/api/streamdeck/commands', (_req, res) => {
    res.json({ success: true, commands: readExcaliburCommands() });
  });

  app.get('/api/streamdeck/status', (_req, res) => {
    res.json({ success: true, status: streamDeckHardware.getStatus() });
  });

  // Supabase cloud sync
  const supabaseSync = new SupabaseSyncService();
  if (config.supabaseUrl && config.supabaseAnonKey && config.machineId) {
    supabaseSync.initialize({
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      machineId: config.machineId,
      machineName: config.machineName ?? 'unknown',
    });
  }

  // Cloud training stats endpoint
  app.get('/api/training/cloud-stats', async (_req, res) => {
    if (!supabaseSync.isEnabled()) {
      res.status(404).json({ success: false, error: 'Cloud sync not configured' });
      return;
    }
    try {
      const stats = await supabaseSync.getAggregateStats();
      res.json({ success: true, result: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // Track all connected panel WebSockets for broadcasting
  const panelConnections = new Set<WebSocket>();
  let mainPanelWs: WebSocket | null = null;

  // WebSocket handling
  wss.on('connection', (ws: WebSocket) => {
    console.log('[Mayday] CEP panel connected');
    panelConnections.add(ws);

    ws.on('message', async (data: Buffer) => {
      try {
        const message: BridgeMessage = JSON.parse(data.toString());

        // Training panel chat
        if (message.type === 'training:chat') {
          const { message: userMessage, history } = message.payload as {
            message: string;
            history: Array<{ role: 'user' | 'assistant'; content: string }>;
          };

          try {
            // Fetch training context
            let trainingContext = '';
            try {
              const stats = await lifecycle.executeCommand('cutting-board', 'training-stats');
              if (stats) {
                const s = stats as any;
                trainingContext = `
## Current Training Data
- Total edits captured: ${s.totalEdits}
- Total sessions: ${s.totalSessions}
- Approval rate: ${s.approvalRate != null ? `${(s.approvalRate * 100).toFixed(1)}%` : 'no ratings yet'}
- Thumbs up: ${s.thumbsUp}, Thumbs down: ${s.thumbsDown}, Boosted: ${s.boostedCount}
- Undo rate: ${(s.undoRate * 100).toFixed(1)}%
- Edit type breakdown: ${Object.entries(s.editsByType).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}
${s.recentSessions.length > 0 ? `- Recent sessions: ${s.recentSessions.map((rs: any) => `"${rs.sequenceName}" (${rs.totalEdits} edits, ${rs.approvalRate != null ? `${(rs.approvalRate * 100).toFixed(0)}% approval` : 'n/a'})`).join('; ')}` : ''}`;
              }
            } catch {
              // Plugin not active or no data
            }

            // Enrich with cloud aggregate data if available
            let cloudContext = '';
            if (supabaseSync.isEnabled()) {
              try {
                const cloudStats = await supabaseSync.getAggregateStats();
                if (cloudStats && cloudStats.machineCount > 1) {
                  cloudContext = `
## Cross-Machine Aggregate (${cloudStats.machineCount} machines)
- Total edits across all machines: ${cloudStats.totalEdits}
- Total sessions: ${cloudStats.totalSessions}
- Overall approval rate: ${cloudStats.approvalRate != null ? `${(cloudStats.approvalRate * 100).toFixed(1)}%` : 'no ratings'}
- Edit type breakdown: ${Object.entries(cloudStats.editsByType).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`;
                }
              } catch {
                // Cloud stats unavailable
              }
            }

            const systemPrompt = `You are an AI video editing coach integrated into Adobe Premiere Pro. You help editors understand their editing patterns and improve their skills based on training data collected during editing sessions.
${trainingContext}${cloudContext}

Be concise, friendly, and focused on actionable editing advice. Reference the specific data when relevant.`;

            // Build messages for multi-turn
            const chatMessages = history.filter(m => m.content.length > 0);

            for await (const delta of aiService.streamWithHistory(chatMessages, {
              system: systemPrompt,
              temperature: 0.7,
            })) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  id: uuid(),
                  type: 'training:chat-delta',
                  payload: { delta },
                  timestamp: Date.now(),
                }));
              }
            }

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                id: uuid(),
                type: 'training:chat-done',
                payload: {},
                timestamp: Date.now(),
              }));
            }
          } catch (err) {
            console.error('[Mayday] Training chat error:', err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                id: uuid(),
                type: 'training:chat-delta',
                payload: { delta: `\n\n[Error: ${err instanceof Error ? err.message : String(err)}]` },
                timestamp: Date.now(),
              }));
              ws.send(JSON.stringify({
                id: uuid(),
                type: 'training:chat-done',
                payload: {},
                timestamp: Date.now(),
              }));
            }
          }
          return;
        }

        // Stream Deck panel messages
        if (message.type === 'streamdeck:get-config') {
          ws.send(JSON.stringify({
            id: uuid(),
            type: 'streamdeck:config-data',
            payload: streamDeckConfig.getConfig(),
            timestamp: Date.now(),
          }));
          return;
        }

        if (message.type === 'streamdeck:update-config') {
          try {
            streamDeckConfig.save(message.payload as any);
            // Respond to sender
            ws.send(JSON.stringify({
              id: uuid(),
              type: 'streamdeck:config-data',
              payload: streamDeckConfig.getConfig(),
              timestamp: Date.now(),
            }));
            // Broadcast to all panels
            broadcastToAllPanels({
              id: uuid(),
              type: 'streamdeck:config-updated' as import('@mayday/types').BridgeMessageType,
              payload: streamDeckConfig.getConfig(),
              timestamp: Date.now(),
            });
          } catch (err) {
            console.error('[StreamDeck] Config update error:', err);
          }
          return;
        }

        if (message.type === 'streamdeck:get-commands') {
          ws.send(JSON.stringify({
            id: uuid(),
            type: 'streamdeck:commands-data',
            payload: { commands: readExcaliburCommands() },
            timestamp: Date.now(),
          }));
          return;
        }

        if (message.type === 'streamdeck:get-status') {
          ws.send(JSON.stringify({
            id: uuid(),
            type: 'streamdeck:status-data',
            payload: streamDeckHardware.getStatus(),
            timestamp: Date.now(),
          }));
          return;
        }

        // Panel identification
        if (message.type === 'panel:ready') {
          const payload = message.payload as { panelId?: string } | undefined;
          if (payload?.panelId === 'training') {
            console.log('[Mayday] Training panel ready');
          } else if (payload?.panelId === 'streamdeck') {
            console.log('[Mayday] Stream Deck panel ready');
          } else {
            // Main panel — set as ExtendScript bridge connection
            mainPanelWs = ws;
            bridge.setCepConnection(ws);
            console.log('[Mayday] Main panel ready');
          }
          return;
        }

        // Route plugin:* messages from panel to EventBus
        if (message.type.startsWith('plugin:') && message.type !== 'plugin:command' && message.type !== 'plugin:result' && message.type !== 'plugin:error') {
          eventBus.emit(message.type, 'panel', message.payload);
        } else {
          bridge.handleMessage(message, ws);
        }
      } catch (err) {
        console.error('[Mayday] Invalid message:', err);
      }
    });

    ws.on('close', () => {
      console.log('[Mayday] CEP panel disconnected');
      panelConnections.delete(ws);
      // Only clear bridge if the main panel (not training panel) disconnected
      if (ws === mainPanelWs) {
        mainPanelWs = null;
        bridge.clearCepConnection();
      }
    });

    // Send server status
    const statusMessage: BridgeMessage<ServerStatusPayload> = {
      id: uuid(),
      type: 'server:status',
      payload: {
        status: 'ready',
        plugins: lifecycle.getActivePlugins().length,
        uptime: Date.now() - startTime,
      },
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(statusMessage));
  });

  // Broadcast a message to all connected panel WebSockets
  function broadcastToAllPanels(message: BridgeMessage) {
    const payload = JSON.stringify(message);
    for (const ws of panelConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  // Forward plugin:* and ui:* events to all connected panels
  eventBus.on('plugin:*', (event) => {
    // Skip bridge-internal types and events that originated from the panel
    if (event.type === 'plugin:command' || event.type === 'plugin:result' || event.type === 'plugin:error') return;
    if (event.source === 'panel') return; // Don't echo panel messages back
    console.log(`[Mayday] Forwarding to panels: ${event.type}`);
    broadcastToAllPanels({
      id: uuid(),
      type: event.type as import('@mayday/types').BridgeMessageType,
      payload: event.data,
      timestamp: Date.now(),
    });
  });

  eventBus.on('ui:*', (event) => {
    broadcastToAllPanels({
      id: uuid(),
      type: event.type as import('@mayday/types').BridgeMessageType,
      payload: event.data,
      timestamp: Date.now(),
    });
  });

  // Start
  server.listen(config.port, () => {
    console.log(`[Mayday] Server running on http://localhost:${config.port}`);
  });

  // Load plugins
  await loader.scanAndLoad();
  loader.watchForChanges();

  console.log(`[Mayday] ${lifecycle.getActivePlugins().length} plugin(s) activated`);

  // Start Supabase sync after plugins are loaded
  if (supabaseSync.isEnabled()) {
    // Push on new edits
    eventBus.on('plugin:cutting-board:feedback-request', (event) => {
      if (event.source === 'panel') return;
      // Debounce: sync will batch on next periodic interval, but push immediately for feedback
      supabaseSync.pushNewData(lifecycle).catch(() => {});
    });

    // Periodic sync for rating updates, session endings, boosts
    supabaseSync.startPeriodicSync(lifecycle, 30000);

    // Push model to cloud when trained
    eventBus.on('plugin:cutting-board:model-trained', () => {
      supabaseSync.pushModel(lifecycle).catch(err => {
        console.error('[SupabaseSync] Model push error:', err);
      });
    });

    // Pull best cloud model on startup (10s delay) and every 5 minutes
    setTimeout(() => {
      supabaseSync.pullBestModel(lifecycle).catch(err => {
        console.error('[SupabaseSync] Model pull error:', err);
      });
    }, 10_000);

    setInterval(() => {
      supabaseSync.pullBestModel(lifecycle).catch(err => {
        console.error('[SupabaseSync] Periodic model pull error:', err);
      });
    }, 5 * 60_000);
  }

  return { server, wss, lifecycle, loader, eventBus, supabaseSync, streamDeckConfig, streamDeckHardware };
}
