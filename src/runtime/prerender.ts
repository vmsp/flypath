import { flightPath } from "../shared/flight.ts";

export type Handler = (request: Request) => Promise<Response>;

export type Prerendered = {
  path: string;
  document: string;
  flight: Uint8Array;
};

const ORIGIN = "http://prerender.invalid";

const BUDGET = 30_000;

async function within<T>(path: string, task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `flypath: prerendering ${path} did not finish within ` +
            `${String(BUDGET / 1000)}s; a prerendered page renders with no ` +
            "request behind it, so anything it waits on has to resolve on " +
            "its own — check what the page suspends on",
        ),
      );
    }, BUDGET);
  });

  try {
    return await Promise.race([task, budget]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(
  handler: Handler,
  path: string,
  url: string,
): Promise<Response> {
  const response = await within(path, handler(new Request(`${ORIGIN}${url}`)));

  if (response.status !== 200) {
    throw new Error(
      `flypath: prerendering ${path} answered ${String(response.status)} for ` +
        `${url}; a prerendered route is written to a file at its own path, ` +
        "so it has to render — drop prerender, or fix what the page does",
    );
  }

  return response;
}

export async function prerenderPages(
  handler: Handler,
  paths: readonly string[],
): Promise<Prerendered[]> {
  const out: Prerendered[] = [];

  for (const path of paths) {
    const document = await fetchOne(handler, path, path);
    const html = await document.text();
    const flight = await fetchOne(handler, path, flightPath(path));
    const bytes = new Uint8Array(await flight.arrayBuffer());
    out.push({ path, document: html, flight: bytes });
  }

  return out;
}
