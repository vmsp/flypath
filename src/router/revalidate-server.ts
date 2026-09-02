import { REVALIDATE_HEADER } from "../protocol/headers.ts";
import { getRequest } from "../runtime/platform.ts";
import { makeRevalidate } from "./revalidate.ts";
import type { Revalidate } from "./types.ts";

export const revalidate: Revalidate = makeRevalidate((mode): void => {
  const request = getRequest();
  if (!request || request.phase !== "action") {
    throw new Error(
      "flypath: revalidate() says what a mutation invalidated, so it only " +
        "works in a server action or a client event handler; a render that " +
        "invalidates its own render is a loop",
    );
  }
  request.outgoing.set(REVALIDATE_HEADER, mode);
});
