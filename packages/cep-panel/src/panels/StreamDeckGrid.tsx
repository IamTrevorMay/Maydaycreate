import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';

interface StreamDeckButton {
  slot: number;
  label: string | null;
  macroId: string | null;
}

interface StreamDeckConfig {
  version: number;
  deviceModel?: string;
  lastUpdated: string;
  buttons: StreamDeckButton[];
}

interface ModelInfo {
  name: string;
  rows: number;
  cols: number;
  total: number;
}

interface Command {
  id: string;
  name: string;
}

interface Props {
  connected: boolean;
  send: (message: BridgeMessage) => void;
  onMessage: (type: string, callback: (payload: unknown) => void) => () => void;
}

export function StreamDeckGrid({ connected, send, onMessage }: Props) {
  const [config, setConfig] = useState<StreamDeckConfig | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [models, setModels] = useState<Record<string, ModelInfo>>({});
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Request config, commands, and models on connect
  useEffect(() => {
    if (!connected) return;
    send({
      id: crypto.randomUUID(),
      type: 'streamdeck:get-config' as any,
      payload: {},
      timestamp: Date.now(),
    });
    send({
      id: crypto.randomUUID(),
      type: 'streamdeck:get-commands' as any,
      payload: {},
      timestamp: Date.now(),
    });
    send({
      id: crypto.randomUUID(),
      type: 'streamdeck:get-models' as any,
      payload: {},
      timestamp: Date.now(),
    });
  }, [connected, send]);

  // Listen for config, command, and model data
  useEffect(() => {
    const unsubs = [
      onMessage('streamdeck:config-data', (payload) => {
        setConfig(payload as StreamDeckConfig);
      }),
      onMessage('streamdeck:config-updated', (payload) => {
        setConfig(payload as StreamDeckConfig);
      }),
      onMessage('streamdeck:commands-data', (payload) => {
        const data = payload as { commands: Command[] };
        setCommands(data.commands);
      }),
      onMessage('streamdeck:models-data', (payload) => {
        const data = payload as { models: Record<string, ModelInfo> };
        setModels(data.models);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [onMessage]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveSlot(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const updateConfig = useCallback((newConfig: StreamDeckConfig) => {
    setConfig(newConfig);
    send({
      id: crypto.randomUUID(),
      type: 'streamdeck:update-config' as any,
      payload: newConfig,
      timestamp: Date.now(),
    });
  }, [send]);

  const handleModelChange = useCallback((model: string) => {
    send({
      id: crypto.randomUUID(),
      type: 'streamdeck:set-model' as any,
      payload: { model },
      timestamp: Date.now(),
    });
  }, [send]);

  const assignCommand = useCallback((slot: number, command: Command | null) => {
    if (!config) return;
    const newButtons = config.buttons.map(b =>
      b.slot === slot
        ? { ...b, label: command?.name ?? null, macroId: command?.id ?? null }
        : b
    );
    updateConfig({ ...config, buttons: newButtons });
    setActiveSlot(null);
  }, [config, updateConfig]);

  const clearSlot = useCallback((slot: number) => {
    assignCommand(slot, null);
  }, [assignCommand]);

  // Drag-to-reorder handlers
  const handleDragStart = useCallback((slot: number) => {
    setDragSlot(slot);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, slot: number) => {
    e.preventDefault();
    setDragOverSlot(slot);
  }, []);

  const handleDrop = useCallback((targetSlot: number) => {
    if (dragSlot === null || dragSlot === targetSlot || !config) {
      setDragSlot(null);
      setDragOverSlot(null);
      return;
    }
    const newButtons = [...config.buttons];
    const srcBtn = newButtons.find(b => b.slot === dragSlot)!;
    const dstBtn = newButtons.find(b => b.slot === targetSlot)!;
    // Swap
    const tmpLabel = srcBtn.label;
    const tmpMacro = srcBtn.macroId;
    srcBtn.label = dstBtn.label;
    srcBtn.macroId = dstBtn.macroId;
    dstBtn.label = tmpLabel;
    dstBtn.macroId = tmpMacro;

    updateConfig({ ...config, buttons: newButtons });
    setDragSlot(null);
    setDragOverSlot(null);
  }, [dragSlot, config, updateConfig]);

  const handleDragEnd = useCallback(() => {
    setDragSlot(null);
    setDragOverSlot(null);
  }, []);

  if (!connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#888' }}>
        Waiting for server connection...
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#888' }}>
        Loading config...
      </div>
    );
  }

  // Resolve grid dimensions from model
  const currentModel = config.deviceModel || 'original';
  const modelInfo = models[currentModel] ?? { name: 'Stream Deck', rows: 3, cols: 5, total: 15 };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Model selector */}
      {Object.keys(models).length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: '#999' }}>Device:</label>
          <select
            value={currentModel}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{
              flex: 1,
              background: '#2a2a2a',
              color: '#ddd',
              border: '1px solid #444',
              borderRadius: 4,
              padding: '3px 6px',
              fontSize: 11,
              outline: 'none',
            }}
          >
            {Object.entries(models).map(([id, info]) => (
              <option key={id} value={id}>{info.name} ({info.rows}×{info.cols})</option>
            ))}
          </select>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${modelInfo.cols}, 1fr)`,
        gap: 4,
        flex: 1,
      }}>
        {config.buttons.map((button) => {
          const isAssigned = button.macroId !== null;
          const isDragging = dragSlot === button.slot;
          const isDragOver = dragOverSlot === button.slot && dragSlot !== button.slot;

          return (
            <div
              key={button.slot}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isDragOver ? '#444' : isDragging ? '#1a1a1a' : isAssigned ? '#333' : '#2a2a2a',
                borderRadius: 6,
                border: isDragOver ? '2px solid #4ade80' : '2px solid transparent',
                cursor: 'pointer',
                minHeight: 56,
                opacity: isDragging ? 0.5 : 1,
                transition: 'background 0.15s, border-color 0.15s',
                userSelect: 'none',
              }}
              draggable={isAssigned}
              onDragStart={() => handleDragStart(button.slot)}
              onDragOver={(e) => handleDragOver(e, button.slot)}
              onDrop={() => handleDrop(button.slot)}
              onDragEnd={handleDragEnd}
              onClick={() => setActiveSlot(activeSlot === button.slot ? null : button.slot)}
            >
              {isAssigned ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textAlign: 'center',
                  padding: '2px 4px',
                  lineHeight: 1.2,
                  wordBreak: 'break-word',
                  overflow: 'hidden',
                  maxHeight: '100%',
                }}>
                  {button.label}
                </span>
              ) : (
                <span style={{ fontSize: 18, color: '#555' }}>+</span>
              )}

              {/* Dropdown / Popover */}
              {activeSlot === button.slot && (
                <div
                  ref={dropdownRef}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    zIndex: 100,
                    background: '#1e1e1e',
                    border: '1px solid #444',
                    borderRadius: 4,
                    minWidth: 160,
                    maxHeight: 200,
                    overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    marginTop: 2,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isAssigned && (
                    <div
                      style={{
                        padding: '6px 8px',
                        cursor: 'pointer',
                        color: '#f87171',
                        borderBottom: '1px solid #333',
                        fontSize: 11,
                      }}
                      onClick={() => clearSlot(button.slot)}
                    >
                      Clear
                    </div>
                  )}
                  {commands.length === 0 ? (
                    <div style={{ padding: '6px 8px', color: '#666', fontSize: 11 }}>
                      No commands found
                    </div>
                  ) : (
                    commands.map((cmd) => (
                      <div
                        key={cmd.id}
                        style={{
                          padding: '5px 8px',
                          cursor: 'pointer',
                          fontSize: 11,
                          background: button.macroId === cmd.id ? '#333' : 'transparent',
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = '#333')}
                        onMouseOut={(e) => (e.currentTarget.style.background = button.macroId === cmd.id ? '#333' : 'transparent')}
                        onClick={() => assignCommand(button.slot, cmd)}
                      >
                        {cmd.name}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>
        Click to assign · Drag to reorder
      </div>
    </div>
  );
}
