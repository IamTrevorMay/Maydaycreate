import type { PluginDefinition, PluginContext } from '@mayday/types';

/**
 * Define a Mayday plugin with type-safe configuration.
 *
 * @example
 * ```ts
 * import { definePlugin } from '@mayday/sdk';
 *
 * export default definePlugin({
 *   async activate(ctx) {
 *     ctx.log.info('Hello from my plugin!');
 *   },
 *   commands: {
 *     greet: async (ctx) => {
 *       const seq = await ctx.services.timeline.getActiveSequence();
 *       ctx.ui.showToast(`Sequence: ${seq?.name ?? 'none'}`);
 *       return seq?.name;
 *     },
 *   },
 * });
 * ```
 */
export function definePlugin<TConfig = Record<string, unknown>>(
  definition: PluginDefinition<TConfig>
): PluginDefinition<TConfig> {
  // Validate the definition shape at load time
  if (typeof definition.activate !== 'function') {
    throw new Error('Plugin must define an activate() function');
  }

  if (definition.commands) {
    for (const [id, handler] of Object.entries(definition.commands)) {
      if (typeof handler !== 'function') {
        throw new Error(`Command "${id}" must be a function`);
      }
    }
  }

  return definition;
}
