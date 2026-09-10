export type Handle = { unref: () => void };

export function after(delay: number, callback: () => void): Handle {
  return globalThis.setTimeout(callback, delay) as unknown as Handle;
}

export function every(delay: number, callback: () => void): Handle {
  return globalThis.setInterval(callback, delay) as unknown as Handle;
}

export function cancel(handle: Handle | undefined): void {
  if (handle === undefined) return;
  globalThis.clearTimeout(handle as unknown as number);
  globalThis.clearInterval(handle as unknown as number);
}
