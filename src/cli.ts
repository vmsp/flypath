#!/usr/bin/env node
import { cac } from "cac";

const cli = cac("flypath");

cli
  .command("web", "Start the dev server (web, flight payloads, native bundles)")
  .option("--port <port>", "Port to listen on", { default: 8081 })
  .option("--host [host]", "Expose the server on the network")
  .action(async (options: { port: number; host?: boolean | string }) => {
    const { createServer } = await import("vite");
    const server = await createServer({
      server: { port: Number(options.port), host: options.host },
    });
    await server.listen();
    server.printUrls();
  });

cli.command("build", "Build for production").action(async () => {
  const { createBuilder } = await import("vite");
  const builder = await createBuilder();
  await builder.buildApp();
});

cli
  .command("ios", "Build and launch the iOS shell")
  .option("--device <name>", "Simulator device name")
  .option("--port <port>", "Dev server port", { default: 8081 })
  .action(async (options: { device?: string; port: number }) => {
    const { runIos } = await import("./native/ios.ts");
    await runIos({ device: options.device, port: Number(options.port) });
  });

cli
  .command("android", "Build and launch the Android shell")
  .option("--port <port>", "Dev server port", { default: 8081 })
  .action(async (options: { port: number }) => {
    const { runAndroid } = await import("./native/android.ts");
    await runAndroid({ port: Number(options.port) });
  });

cli.help();
cli.version("0.0.0");
cli.parse();
