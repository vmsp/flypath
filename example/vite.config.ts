import { defineConfig } from "flypath/vite";

export default defineConfig({
  appName: "Flypath Example",
  version: "2.1",
  buildNumber: 7,
  jobs: {
    queues: {
      default: { concurrency: 5 },
      notifications: {
        concurrency: 2,
        retries: 5,
        retryDelay: 5,
        backoff: true,
        timeout: 60,
      },
      maintenance: { concurrency: 1, notify: false, pollInterval: 5 },
    },
  },
});
