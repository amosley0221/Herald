import type { SourceAdapter } from './types.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { workdayAdapter } from './workday.js';
import { jsonAdapter } from './json.js';
import { commandAdapter } from './command.js';

/**
 * Adapter registry. A config's `adapter` field names one of these keys.
 * The `json` and `command` adapters cover any source the named ones do not,
 * so adding a board is a config change rather than a release.
 */
export const ADAPTERS: Readonly<Record<string, SourceAdapter>> = Object.freeze({
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workday: workdayAdapter,
  json: jsonAdapter,
  command: commandAdapter,
});

export function getAdapter(name: string): SourceAdapter {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(`Unknown source adapter "${name}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}

export * from './types.js';
