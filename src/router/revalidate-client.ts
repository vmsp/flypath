import { getRouter } from "./dispatch.ts";
import { makeRevalidate } from "./revalidate.ts";
import type { Revalidate } from "./types.ts";

export const revalidate: Revalidate = makeRevalidate((mode): void => {
  const router = getRouter();
  if (!router) {
    throw new Error(
      "flypath: revalidate() ran before the flypath router was ready",
    );
  }
  router.revalidate(mode);
});
