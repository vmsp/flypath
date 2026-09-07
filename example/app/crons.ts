import { cron } from "flypath";

import { pruneNotes } from "./jobs.ts";

export default [
  cron("0 3 * * *", () => pruneNotes(30), {
    name: "nightly-prune",
    queue: "maintenance",
    timezone: "Europe/Lisbon",
  }),
];
