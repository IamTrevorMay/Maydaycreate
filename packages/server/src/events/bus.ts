import type { MaydayEvent, EventHandler, EventSubscription } from '@mayday/types';

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(eventType: string, handler: EventHandler<T>): EventSubscription {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    const typedHandler = handler as EventHandler;
    this.handlers.get(eventType)!.add(typedHandler);

    return {
      unsubscribe: () => {
        this.handlers.get(eventType)?.delete(typedHandler);
      },
    };
  }

  async emit<T = unknown>(eventType: string, source: string, data: T): Promise<void> {
    const event: MaydayEvent<T> = {
      type: eventType,
      source,
      timestamp: Date.now(),
      data,
    };

    // Exact match handlers
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(event as MaydayEvent);
        } catch (err) {
          console.error(`[EventBus] Error in handler for ${eventType}:`, err);
        }
      }
    }

    // Wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await handler(event as MaydayEvent);
        } catch (err) {
          console.error(`[EventBus] Error in wildcard handler:`, err);
        }
      }
    }

    // Namespace wildcard (e.g., 'plugin:*' matches 'plugin:activated')
    const namespace = eventType.split(':')[0];
    const nsWildcard = `${namespace}:*`;
    const nsHandlers = this.handlers.get(nsWildcard);
    if (nsHandlers) {
      for (const handler of nsHandlers) {
        try {
          await handler(event as MaydayEvent);
        } catch (err) {
          console.error(`[EventBus] Error in namespace handler for ${nsWildcard}:`, err);
        }
      }
    }
  }

  removeAllListeners(eventType?: string) {
    if (eventType) {
      this.handlers.delete(eventType);
    } else {
      this.handlers.clear();
    }
  }
}
