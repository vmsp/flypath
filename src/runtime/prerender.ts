import { flightPath } from "../shared/flight.ts";
import { collect } from "./stream.ts";

export type Handler = (request: Request) => Promise<Response>;

export type Prerendered = {
  path: string;
  document: string;
  flight: Uint8Array;
};

const ORIGIN = "http://prerender.invalid";

const BUDGET = 30_000;

async function within<T>(
  path: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `Prerendering ${path} did not finish within ` +
          `${String(BUDGET / 1000)}s; a prerendered page renders with no ` +
          "request behind it, so anything it waits on has to resolve on " +
          "its own — check what the page suspends on",
      );
      controller.abort(error);
      reject(error);
    }, BUDGET);
  });

  try {
    return await Promise.race([task(controller.signal), budget]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(
  handler: Handler,
  path: string,
  url: string,
): Promise<Uint8Array> {
  return within(path, async (signal) => {
    const response = await handler(new Request(`${ORIGIN}${url}`, { signal }));

    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      throw new Error(
        `Prerendering ${path} answered ${String(response.status)} for ` +
          `${url}; a prerendered route is written to a file at its own path, ` +
          "so it has to render — drop prerender, or fix what the page does",
      );
    }

    return response.body ? collect(response.body, signal) : new Uint8Array();
  });
}

export async function prerenderPages(
  handler: Handler,
  paths: readonly string[],
): Promise<Prerendered[]> {
  const out: Prerendered[] = [];

  for (const path of paths) {
    const document = await fetchOne(handler, path, path);
    const html = new TextDecoder().decode(document);
    const flight = await fetchOne(handler, path, flightPath(path));
    out.push({ path, document: html, flight });
  }

  return out;
}
