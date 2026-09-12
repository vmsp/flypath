import { getRequest } from "../runtime/platform.ts";
import { REVALIDATE_HEADER } from "../shared/headers.ts";
import { makeRevalidate } from "./revalidate.ts";
import type { Revalidate } from "./types.ts";

export const revalidate: Revalidate = makeRevalidate((mode): void => {
  const request = getRequest();
  if (!request || request.phase !== "action") {
    throw new Error(
      "revalidate() can only run in a server action or client event handler",
    );
  }
  request.outgoing.set(REVALIDATE_HEADER, mode);
});
