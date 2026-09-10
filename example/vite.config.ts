import { defineConfig } from "flypath/vite";

export default defineConfig({
  appName: "Flypath Example",
  version: "2.1",
  buildNumber: 7,
  url: "http://localhost:3000",
  serve: {
    cluster: true,
    // tls: {
    //   acme: {
    //     email: "ops@example.com",
    //     domains: ["example.com", "www.example.com"],
    //     directory: "staging",
    //     agree: true,
    //   },
    // },
  },
  mail: {
    from: "Flypath <hello@example.com>",
  },
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
