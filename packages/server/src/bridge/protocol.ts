import { v4 as uuid } from 'uuid';
import type { BridgeMessage, ExtendScriptCallPayload } from '@mayday/types';

export function createExtendScriptCall(fn: string, args: unknown[] = [], priority = false): BridgeMessage<ExtendScriptCallPayload> {
  return {
    id: uuid(),
    type: 'extendscript:call',
    payload: {
      script: 'maydayCall',
      fn,
      args,
      ...(priority ? { priority: true } : {}),
    },
    timestamp: Date.now(),
  };
}

export function createResponse<T>(requestId: string, type: BridgeMessage['type'], payload: T): BridgeMessage<T> {
  return {
    id: uuid(),
    type,
    payload,
    timestamp: Date.now(),
  };
}
