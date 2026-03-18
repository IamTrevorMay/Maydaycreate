/**
 * Typed wrapper around Adobe's CSInterface.
 * CSInterface.js is loaded globally via the CEP panel HTML.
 */

declare class CSInterface {
  evalScript(script: string, callback?: (result: string) => void): void;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  removeEventListener(type: string, listener: (event: { data: string }) => void): void;
  requestOpenExtension(extensionId: string): void;
  getSystemPath(pathType: string): string;
  closeExtension(): void;
  registerKeyEventsInterest(keyEventsInterest: string): void;
}

let csInterface: CSInterface | null = null;

export function getCSInterface(): CSInterface | null {
  if (csInterface) return csInterface;
  try {
    csInterface = new (window as unknown as { CSInterface: new () => CSInterface }).CSInterface();
    return csInterface;
  } catch {
    // Not running inside CEP
    return null;
  }
}

// ── Serial queue for CSInterface.evalScript ──────────────────────────────────
// Adobe's evalScript cannot handle overlapping calls — responses get cross-wired.
// All callers go through this queue; only one evalScript is in-flight at a time.

type QueueItem = {
  fn: string;
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

const queue: QueueItem[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      const result = await execOne(item.fn, item.args);
      item.resolve(result);
    } catch (err) {
      item.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  processing = false;
}

function execOne(fn: string, args: unknown[]): Promise<unknown> {
  const csi = getCSInterface();
  if (!csi) {
    console.error('[Mayday] CSInterface not available. window.__adobe_cep__:', typeof (window as any).__adobe_cep__);
    return Promise.reject(new Error('Not running in CEP environment — CSInterface unavailable'));
  }

  const argsJson = JSON.stringify(args);
  // Escape backslashes first (so \" survives ExtendScript string parsing), then single quotes
  const escaped = argsJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const script = `maydayCall("${fn}", '${escaped}')`;

  return new Promise((resolve, reject) => {
    csi.evalScript(script, (resultStr: string) => {
      if (resultStr === 'EvalScript error.') {
        reject(new Error(`ExtendScript error calling ${fn}`));
        return;
      }
      try {
        const result = JSON.parse(resultStr);
        if (result.success) {
          resolve(result.data);
        } else {
          reject(new Error(result.error));
        }
      } catch {
        resolve(resultStr);
      }
    });
  });
}

export async function evalExtendScript(fn: string, args: unknown[] = [], priority = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const item: QueueItem = { fn, args, resolve, reject };
    if (priority) {
      // Insert at front (behind any currently-executing item, which has already been shifted off)
      queue.unshift(item);
    } else {
      queue.push(item);
    }
    processQueue();
  });
}
