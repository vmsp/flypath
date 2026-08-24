import { setRequireModule } from "@vitejs/plugin-rsc/core/browser";
import references from "virtual:vite-rsc/client-references";

const BUILD = import.meta.env["__vite_rsc_build__"] === true;

function base(): string {
  const value = import.meta.env.BASE_URL;
  return value.endsWith("/") ? value : `${value}/`;
}

function stableUrl(id: string): string {
  const [file, query] = id.split("?");
  if (query === undefined) return id;
  const kept = query
    .split("&")
    .filter((part) => !part.startsWith("t="))
    .join("&");
  return kept === "" ? (file as string) : `${file}?${kept}`;
}

setRequireModule({
  load: async (id: string) => {
    if (!BUILD) {
      return __vite_rsc_raw_import__(base() + stableUrl(id).slice(1));
    }
    const load = references[id];
    if (!load) throw new Error(`flypath: client reference not found "${id}"`);
    return load();
  },
});
