import { createFromFetch } from "@vitejs/plugin-rsc/browser";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";

function fetchFlight(): Promise<Response> {
  const url = new URL(window.location.href);
  url.searchParams.set("__flight", "1");
  return fetch(url);
}

async function main(): Promise<void> {
  const root = hydrateRoot(
    document,
    await createFromFetch<ReactNode>(fetchFlight()),
  );

  if (import.meta.hot) {
    import.meta.hot.on("rsc:update", () => {
      void createFromFetch<ReactNode>(fetchFlight()).then((node) => {
        root.render(node);
      });
    });
  }
}

void main();
