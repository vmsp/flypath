#!/usr/bin/env node
import { cac } from "cac";

const cli = cac("flypath");

const port = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value);

cli
  .command("dev", "Start the dev server (web, flight payloads, native bundles)")
  .option("--port <port>", "Port to listen on")
  .option("--host [host]", "Expose the server on the network")
  .action(async (options: { port?: string; host?: boolean | string }) => {
    const { createServer } = await import("vite");
    const server = await createServer({
      server: { port: port(options.port), host: options.host },
    });
    await server.listen();
    server.printUrls();
  });

cli.command("build", "Build for production").action(async () => {
  const { loadOptions } = await import("./native/config.ts");
  const { scaffoldNative } = await import("./native/scaffold.ts");
  const { projectContext } = await import("./native/template.ts");
  const root = process.cwd();
  try {
    const options = await loadOptions(root);
    scaffoldNative(projectContext(root, options.port ?? 8081, options));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("react-native")) {
      throw error;
    }
  }

  const { createBuilder } = await import("vite");
  const builder = await createBuilder();
  await builder.buildApp();
});

cli
  .command("ios", "Build and launch the iOS shell")
  .option("--device <name>", "Simulator device name")
  .option("--port <port>", "Dev server port")
  .action(async (options: { device?: string; port?: string }) => {
    const { runIos } = await import("./native/ios.ts");
    await runIos({ device: options.device, port: port(options.port) });
  });

cli
  .command("android", "Build and launch the Android shell")
  .option("--port <port>", "Dev server port")
  .action(async (options: { port?: string }) => {
    const { runAndroid } = await import("./native/android.ts");
    await runAndroid({ port: port(options.port) });
  });

cli.help();
cli.version("0.0.0");
cli.parse();
