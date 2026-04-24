import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';

interface ButtonStyle {
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
}

interface StreamDeckButton extends ButtonStyle {
  slot: number;
  label: string | null;
  macroId: string | null;
}

interface StreamDeckTrainingButton extends ButtonStyle {
  slot: number;
  label: string | null;
  actionType: 'tag' | 'submit' | 'clear' | null;
  actionId: string | null;
}

interface StreamDeckConfig {
  version: number;
  deviceModel?: string;
  lastUpdated: string;
  buttons: StreamDeckButton[];
  trainingButtons?: StreamDeckTrainingButton[];
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
  mode: 'editing' | 'training';
}

const FONT_SIZE_OPTIONS = [8, 10, 12, 14, 18];
const COLOR_PRESETS = [
  '#ffffff', '#e2e8f0', '#93c5fd', '#86efac', '#fde68a', '#fca5a5',
  '#c4b5fd', '#f9a8d4', '#fdba74', '#67e8f9',
];
const BG_COLOR_PRESETS = [
  '#1a1a2e', '#2a2a3e', '#333333', '#1e3a5f', '#22573c', '#7f1d1d',
  '#4a1d6e', '#6b3a0a', '#1a3a3a', '#3a1a1a',
];

export function StreamDeckGrid({ connected, send, onMessage, mode }: Props) {
  const [config, setConfig] = useState<StreamDeckConfig | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [models, setModels] = useState<Record<string, ModelInfo>>({});
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [customizeSlot, setCustomizeSlot] = useState<number | null>(null);
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [trainingTags, setTrainingTags] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const customizeRef = useRef<HTMLDivElement>(null);
  const activeButtonRef = useRef<HTMLDivElement>(null);
  const [openUp, setOpenUp] = useState(false);

  // Request config, commands, and models on connect
  useEffect(() => {
    if (!connected) return;
    send({ id: crypto.randomUUID(), type: 'streamdeck:get-config' as any, payload: {}, timestamp: Date.now() });
    send({ id: crypto.randomUUID(), type: 'streamdeck:get-commands' as any, payload: {}, timestamp: Date.now() });
    send({ id: crypto.randomUUID(), type: 'streamdeck:get-models' as any, payload: {}, timestamp: Date.now() });
  }, [connected, send]);

  // Listen for data messages
  useEffect(() => {
    const unsubs = [
      onMessage('streamdeck:config-data', (p) => setConfig(p as StreamDeckConfig)),
      onMessage('streamdeck:config-updated', (p) => setConfig(p as StreamDeckConfig)),
      onMessage('streamdeck:commands-data', (p) => setCommands((p as any).commands)),
      onMessage('streamdeck:models-data', (p) => setModels((p as any).models)),
      onMessage('streamdeck:training-state', (p) => setTrainingTags((p as any).tags)),
    ];
    return () => unsubs.forEach(u => u());
  }, [onMessage]);

  // Refresh commands every time a button is clicked (activeSlot changes)
  useEffect(() => {
    if (activeSlot !== null && connected) {
      send({ id: crypto.randomUUID(), type: 'streamdeck:get-commands' as any, payload: {}, timestamp: Date.now() });
    }
  }, [activeSlot, connected, send]);

  // Clear active/customize slots on mode change
  useEffect(() => {
    setActiveSlot(null);
    setCustomizeSlot(null);
  }, [mode]);

  // Decide whether dropdown should open upward or downward
  useEffect(() => {
    if (activeSlot !== null && activeButtonRef.current) {
      const rect = activeButtonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < 210 && spaceAbove > spaceBelow);
    }
  }, [activeSlot]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveSlot(null);
      }
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setCustomizeSlot(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const updateConfig = useCallback((newConfig: StreamDeckConfig) => {
    setConfig(newConfig);
    send({ id: crypto.randomUUID(), type: 'streamdeck:update-config' as any, payload: newConfig, timestamp: Date.now() });
  }, [send]);

  const handleModelChange = useCallback((model: string) => {
    send({ id: crypto.randomUUID(), type: 'streamdeck:set-model' as any, payload: { model }, timestamp: Date.now() });
  }, [send]);

  // ── Editing mode handlers ──────────────────────────────────────────────

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

  // ── Drag-to-reorder (works in both modes) ─────────────────────────────

  const handleDragStart = useCallback((slot: number) => setDragSlot(slot), []);
  const handleDragOver = useCallback((e: React.DragEvent, slot: number) => {
    e.preventDefault();
    setDragOverSlot(slot);
  }, []);
  const handleDragEnd = useCallback(() => { setDragSlot(null); setDragOverSlot(null); }, []);

  const handleDrop = useCallback((targetSlot: number) => {
    if (dragSlot === null || dragSlot === targetSlot || !config) {
      setDragSlot(null); setDragOverSlot(null); return;
    }

    if (mode === 'training') {
      const tb = [...(config.trainingButtons ?? [])];
      const src = tb.find(b => b.slot === dragSlot);
      const dst = tb.find(b => b.slot === targetSlot);
      if (src && dst) {
        // Swap everything except slot number
        const { slot: sSlot, ...sData } = src;
        const { slot: dSlot, ...dData } = dst;
        Object.assign(src, { slot: sSlot, ...dData });
        Object.assign(dst, { slot: dSlot, ...sData });
        updateConfig({ ...config, trainingButtons: tb });
      }
    } else {
      const buttons = [...config.buttons];
      const src = buttons.find(b => b.slot === dragSlot);
      const dst = buttons.find(b => b.slot === targetSlot);
      if (src && dst) {
        const { slot: sSlot, ...sData } = src;
        const { slot: dSlot, ...dData } = dst;
        Object.assign(src, { slot: sSlot, ...dData });
        Object.assign(dst, { slot: dSlot, ...sData });
        updateConfig({ ...config, buttons });
      }
    }
    setDragSlot(null); setDragOverSlot(null);
  }, [dragSlot, config, updateConfig, mode]);

  // ── Button customization ──────────────────────────────────────────────

  const updateButtonStyle = useCallback((slot: number, style: Partial<ButtonStyle>) => {
    if (!config) return;
    if (mode === 'training') {
      const tb = (config.trainingButtons ?? []).map(b =>
        b.slot === slot ? { ...b, ...style } : b
      );
      updateConfig({ ...config, trainingButtons: tb });
    } else {
      const buttons = config.buttons.map(b =>
        b.slot === slot ? { ...b, ...style } : b
      );
      updateConfig({ ...config, buttons });
    }
  }, [config, updateConfig, mode]);

  // ── Training mode handlers ────────────────────────────────────────────

  const handleTrainingTagClick = useCallback((tagId: string) => {
    send({ id: crypto.randomUUID(), type: 'streamdeck:training-toggle-tag' as any, payload: { tagId }, timestamp: Date.now() });
  }, [send]);

  const handleTrainingAction = useCallback((action: string) => {
    send({ id: crypto.randomUUID(), type: 'streamdeck:training-toggle-tag' as any, payload: { action }, timestamp: Date.now() });
  }, [send]);

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

  const currentModel = config.deviceModel || 'original';
  const modelInfo = models[currentModel] ?? { name: 'Mayday Shortcuts', rows: 3, cols: 5, total: 15 };

  // Get the right button for customization
  const getCustomizeButton = (): (ButtonStyle & { label: string | null }) | null => {
    if (customizeSlot === null) return null;
    if (mode === 'training') {
      return config.trainingButtons?.find(b => b.slot === customizeSlot) ?? null;
    }
    return config.buttons.find(b => b.slot === customizeSlot) ?? null;
  };

  const customizeButton = getCustomizeButton();

  // ── Customization panel (shared between modes) ─────────────────────────
  const renderCustomizePanel = () => {
    if (customizeSlot === null || !customizeButton) return null;
    return (
      <div
        ref={customizeRef}
        style={{
          background: '#1e1e1e',
          border: '1px solid #444',
          borderRadius: 6,
          padding: 8,
          fontSize: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: '#ccc' }}>
            Customize: {customizeButton.label || `Slot ${customizeSlot}`}
          </span>
          <span
            onClick={() => setCustomizeSlot(null)}
            style={{ cursor: 'pointer', color: '#888', fontSize: 12, lineHeight: 1 }}
          >&times;</span>
        </div>

        {/* Font size */}
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: '#888' }}>Size:</span>
          <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
            {FONT_SIZE_OPTIONS.map(size => (
              <button
                key={size}
                onClick={() => updateButtonStyle(customizeSlot, { fontSize: size })}
                style={{
                  background: (customizeButton.fontSize ?? 14) === size ? '#2680eb' : '#333',
                  color: (customizeButton.fontSize ?? 14) === size ? '#fff' : '#aaa',
                  border: 'none', borderRadius: 3,
                  padding: '2px 6px', fontSize: 10, cursor: 'pointer',
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Font color */}
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: '#888' }}>Text color:</span>
          <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
            {COLOR_PRESETS.map(color => (
              <div
                key={color}
                onClick={() => updateButtonStyle(customizeSlot, { fontColor: color })}
                style={{
                  width: 16, height: 16, borderRadius: 3,
                  background: color, cursor: 'pointer',
                  border: (customizeButton.fontColor || '#ffffff') === color
                    ? '2px solid #2680eb' : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>

        {/* Background color */}
        <div>
          <span style={{ color: '#888' }}>Background:</span>
          <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
            {BG_COLOR_PRESETS.map(color => (
              <div
                key={color}
                onClick={() => updateButtonStyle(customizeSlot, { bgColor: color })}
                style={{
                  width: 16, height: 16, borderRadius: 3,
                  background: color, cursor: 'pointer',
                  border: (customizeButton.bgColor || '#333333') === color
                    ? '2px solid #2680eb' : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Training mode grid ─────────────────────────────────────────────────
  if (mode === 'training') {
    const trainingButtons = config.trainingButtons ?? [];

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
                flex: 1, background: '#2a2a2a', color: '#ddd',
                border: '1px solid #444', borderRadius: 4,
                padding: '3px 6px', fontSize: 11, outline: 'none',
              }}
            >
              {Object.entries(models).map(([id, info]) => (
                <option key={id} value={id}>{info.name} ({info.rows}&times;{info.cols})</option>
              ))}
            </select>
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${modelInfo.cols}, 1fr)`,
          gap: 4, flex: 1,
        }}>
          {trainingButtons.map((button) => {
            const hasAction = button.actionType !== null;
            const isTag = button.actionType === 'tag' && button.actionId;
            const active = isTag ? trainingTags.includes(button.actionId!) : false;
            const isDragging = dragSlot === button.slot;
            const isDragOver = dragOverSlot === button.slot && dragSlot !== button.slot;

            const bgColor = active ? '#22573c'
              : button.bgColor || (button.actionType === 'submit' ? '#22573c'
              : button.actionType === 'clear' ? '#7f1d1d' : '#2a2a3e');
            const fgColor = active ? '#ffffff'
              : button.fontColor || (hasAction ? '#8c8c8c' : '#555');
            const fontSize = button.fontSize ?? 10;

            return (
              <div
                key={button.slot}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isDragOver ? '#444' : isDragging ? '#1a1a1a' : bgColor,
                  borderRadius: 6,
                  border: isDragOver ? '2px solid #4ade80' : active ? '2px solid #34d399' : '2px solid transparent',
                  cursor: hasAction ? 'pointer' : 'default',
                  minHeight: 56, opacity: isDragging ? 0.5 : 1,
                  transition: 'all 0.15s', userSelect: 'none',
                }}
                draggable={hasAction}
                onDragStart={() => handleDragStart(button.slot)}
                onDragOver={(e) => handleDragOver(e, button.slot)}
                onDrop={() => handleDrop(button.slot)}
                onDragEnd={handleDragEnd}
                onClick={() => {
                  if (isTag) handleTrainingTagClick(button.actionId!);
                  else if (button.actionType === 'submit') handleTrainingAction('submit');
                  else if (button.actionType === 'clear') handleTrainingAction('clear');
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCustomizeSlot(customizeSlot === button.slot ? null : button.slot);
                }}
              >
                {hasAction ? (
                  <span style={{
                    fontSize, fontWeight: active ? 700 : 400,
                    textAlign: 'center', padding: '2px 4px', lineHeight: 1.2,
                    color: fgColor, wordBreak: 'break-word',
                  }}>
                    {button.label}
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: '#333' }}></span>
                )}
              </div>
            );
          })}
        </div>

        {renderCustomizePanel()}

        <div style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>
          Click to toggle · Drag to reorder · Right-click to customize
        </div>
      </div>
    );
  }

  // ── Editing mode grid ──────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'visible' }}>
      {/* Model selector */}
      {Object.keys(models).length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: '#999' }}>Device:</label>
          <select
            value={currentModel}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{
              flex: 1, background: '#2a2a2a', color: '#ddd',
              border: '1px solid #444', borderRadius: 4,
              padding: '3px 6px', fontSize: 11, outline: 'none',
            }}
          >
            {Object.entries(models).map(([id, info]) => (
              <option key={id} value={id}>{info.name} ({info.rows}&times;{info.cols})</option>
            ))}
          </select>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${modelInfo.cols}, 1fr)`,
        gap: 4, flex: 1, overflow: 'visible',
      }}>
        {config.buttons.map((button) => {
          const isAssigned = button.macroId !== null;
          const isDragging = dragSlot === button.slot;
          const isDragOver = dragOverSlot === button.slot && dragSlot !== button.slot;
          const bgColor = button.bgColor || (isAssigned ? '#333' : '#2a2a2a');
          const fgColor = button.fontColor || '#ffffff';
          const fontSize = button.fontSize ?? 10;

          return (
            <div
              key={button.slot}
              ref={activeSlot === button.slot ? activeButtonRef : undefined}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isDragOver ? '#444' : isDragging ? '#1a1a1a' : bgColor,
                borderRadius: 6,
                border: isDragOver ? '2px solid #4ade80' : '2px solid transparent',
                cursor: 'pointer', minHeight: 56,
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
              onContextMenu={(e) => {
                e.preventDefault();
                if (isAssigned) {
                  setCustomizeSlot(customizeSlot === button.slot ? null : button.slot);
                }
              }}
            >
              {isAssigned ? (
                <span style={{
                  fontSize, fontWeight: 600,
                  textAlign: 'center', padding: '2px 4px', lineHeight: 1.2,
                  wordBreak: 'break-word', overflow: 'hidden', maxHeight: '100%',
                  color: fgColor,
                }}>
                  {button.label}
                </span>
              ) : (
                <span style={{ fontSize: 18, color: '#555' }}>+</span>
              )}

              {/* Command assignment dropdown */}
              {activeSlot === button.slot && (
                <div
                  ref={dropdownRef}
                  style={{
                    position: 'absolute',
                    ...(openUp
                      ? { bottom: '100%', marginBottom: 2 }
                      : { top: '100%', marginTop: 2 }),
                    left: 0,
                    zIndex: 10000,
                    background: '#1e1e1e', border: '1px solid #444', borderRadius: 4,
                    minWidth: 160, maxHeight: 200, overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isAssigned && (
                    <div
                      style={{
                        padding: '6px 8px', cursor: 'pointer', color: '#f87171',
                        borderBottom: '1px solid #333', fontSize: 11,
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
                          padding: '5px 8px', cursor: 'pointer', fontSize: 11,
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

      {renderCustomizePanel()}

      <div style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>
        Click to assign · Drag to reorder · Right-click to customize
      </div>
    </div>
  );
}
