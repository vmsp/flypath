import { isEmail } from "../mail/context.ts";
import {
  assertNoClientReference,
  createEmailIntrinsic,
} from "./element-email.ts";
import { createNativeIntrinsic } from "./element-native.ts";
import { createIntrinsic } from "./element.ts";
import { isNative } from "./platform.ts";

export function serverIntrinsic(
  type: unknown,
): typeof createIntrinsic | undefined {
  const email = isEmail();
  if (typeof type !== "string") {
    if (email) assertNoClientReference(type);
    return undefined;
  }
  return email
    ? createEmailIntrinsic
    : isNative()
      ? createNativeIntrinsic
      : createIntrinsic;
}
