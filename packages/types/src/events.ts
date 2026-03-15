/** Event system types */

export interface MaydayEvent<T = unknown> {
  type: string;
  source: string;
  timestamp: number;
  data: T;
}

export type EventHandler<T = unknown> = (event: MaydayEvent<T>) => void | Promise<void>;

export interface EventSubscription {
  unsubscribe(): void;
}

// Built-in event types
export interface PluginActivatedEvent {
  pluginId: string;
}

export interface PluginDeactivatedEvent {
  pluginId: string;
}

export interface PluginErrorEvent {
  pluginId: string;
  error: string;
}

export interface SequenceChangedEvent {
  sequenceId: string;
  name: string;
}

export interface PlayheadMovedEvent {
  position: number;
  sequenceId: string;
}

export interface TimelineModifiedEvent {
  sequenceId: string;
  action: 'clip-added' | 'clip-removed' | 'clip-moved' | 'marker-added' | 'marker-removed';
}

// Edit detection types
export type EditType = 'cut' | 'trim-head' | 'trim-tail' | 'delete' | 'move' | 'add';

export interface EditDetectedEvent {
  editType: EditType;
  editPointTime: number;
  clipName: string;
  mediaPath: string;
  trackIndex: number;
  trackType: 'video' | 'audio';
  sequenceId: string;
  isUndo: boolean;
}

// Event type map for type-safe subscriptions
export interface EventMap {
  'plugin:activated': PluginActivatedEvent;
  'plugin:deactivated': PluginDeactivatedEvent;
  'plugin:error': PluginErrorEvent;
  'sequence:changed': SequenceChangedEvent;
  'playhead:moved': PlayheadMovedEvent;
  'timeline:modified': TimelineModifiedEvent;
  'edit:detected': EditDetectedEvent;
  [key: string]: unknown;
}
