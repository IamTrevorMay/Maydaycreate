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

export async function evalExtendScript(fn: string, args: unknown[] = []): Promise<unknown> {
  const csi = getCSInterface();
  if (!csi) {
    console.error('[Mayday] CSInterface not available. window.__adobe_cep__:', typeof (window as any).__adobe_cep__);
    throw new Error('Not running in CEP environment — CSInterface unavailable');
  }

  const argsJson = JSON.stringify(args);
  const script = `maydayCall("${fn}", '${argsJson.replace(/'/g, "\\'")}')`;

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
