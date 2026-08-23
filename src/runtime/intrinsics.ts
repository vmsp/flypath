import { nativeIntrinsics } from "../components/native/index.ts";
import { isNative } from "./platform.ts";

export function resolveIntrinsic(type: unknown): unknown {
  if (typeof type !== "string" || !isNative()) return type;
  const mapped = (nativeIntrinsics as Record<string, unknown>)[type];
  if (mapped === undefined) {
    throw new Error(
      `flypath: <${type}> has no native equivalent registered in components/native`,
    );
  }
  return mapped;
}
