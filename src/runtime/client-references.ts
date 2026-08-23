import { setRequireModule } from "@vitejs/plugin-rsc/core/browser";
import { registry } from "virtual:flypath/client-references";

export function normalizeReferenceId(id: string): string {
  let value = id.split("$$")[0] ?? id;
  const cache = value.indexOf("?");
  if (cache !== -1) value = value.slice(0, cache);
  if (value.startsWith("/@fs")) value = value.slice("/@fs".length);
  return value;
}

export function installClientReferences(): void {
  setRequireModule({
    load: async (id: string) => {
      const key = normalizeReferenceId(id);
      const mod = registry[key];
      if (!mod) {
        throw new Error(
          `flypath: client reference "${id}" is not part of the native bundle. ` +
            "Only flypath primitives can be rendered on native.",
        );
      }
      return mod;
    },
  });
}
