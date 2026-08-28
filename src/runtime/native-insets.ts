import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

import type { Insets } from "../components/native/insets.ts";
import { ZERO_INSETS } from "../components/native/insets.ts";

type InsetsModule = TurboModule & {
  getInsets: () => Insets;
  observe: (listener: ((insets: Insets) => void) | null) => void;
};

let module: InsetsModule | null | undefined;

function insetsModule(): InsetsModule | null {
  if (module === undefined) {
    module = TurboModuleRegistry.get<InsetsModule>("FlypathInsets") ?? null;
  }
  return module;
}

function normalize(value: Partial<Insets> | undefined): Insets {
  if (!value) return ZERO_INSETS;
  return {
    top: Number(value.top) || 0,
    bottom: Number(value.bottom) || 0,
    left: Number(value.left) || 0,
    right: Number(value.right) || 0,
  };
}

export function readInsets(): Insets {
  const native = insetsModule();
  if (!native) return ZERO_INSETS;
  try {
    return normalize(native.getInsets());
  } catch {
    return ZERO_INSETS;
  }
}

export function watchInsets(listener: (insets: Insets) => void): () => void {
  const native = insetsModule();
  if (!native) return () => undefined;

  let active = true;
  native.observe((insets) => {
    if (active) listener(normalize(insets));
  });

  return () => {
    active = false;
    native.observe(null);
  };
}
