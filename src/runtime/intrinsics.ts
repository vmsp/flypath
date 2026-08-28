import { nativeIntrinsics } from "../components/native/index.ts";

const METADATA = new Set(["title"]);

export function isMetadata(type: string): boolean {
  return METADATA.has(type);
}

export function resolveIntrinsic(type: string): unknown {
  const mapped = (nativeIntrinsics as Record<string, unknown>)[type];
  if (mapped === undefined) {
    throw new Error(
      `flypath: <${type}> has no native equivalent registered in components/native`,
    );
  }
  return mapped;
}
