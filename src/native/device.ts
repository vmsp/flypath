import os from "node:os";

import { run } from "./exec.ts";

export type Target = {
  kind: "simulator" | "device";
  platform: "ios" | "android";
  id: string;
  name: string;
  state: string;
};

function lanAddress(): string | undefined {
  const candidates: string[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== "IPv4") continue;
      if (name.startsWith("bridge") || name.startsWith("docker")) continue;
      if (name.startsWith("utun") || name.startsWith("tun")) continue;
      if (entry.address.startsWith("169.254.")) continue;
      candidates.push(entry.address);
    }
  }
  return candidates[0];
}

export function resolveHost(override: string | undefined): string {
  if (override !== undefined && override !== "") return override;
  const address = lanAddress();
  if (address === undefined) {
    throw new Error(
      "flypath: could not find a LAN address for this machine, and a device " +
        "cannot reach localhost — pass --host with the address the device " +
        "should use",
    );
  }
  return address;
}

type SimctlDevice = {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
};

async function iosSimulators(): Promise<Target[]> {
  let raw: string;
  try {
    raw = await run("xcrun", ["simctl", "list", "devices", "-j"], {
      capture: true,
    });
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as { devices: Record<string, SimctlDevice[]> };
  const runtimes = Object.keys(parsed.devices)
    .filter((key) => key.includes("iOS"))
    .toSorted();

  return runtimes
    .flatMap((key) => parsed.devices[key] ?? [])
    .filter((device) => device.isAvailable)
    .map((device) => ({
      kind: "simulator" as const,
      platform: "ios" as const,
      id: device.udid,
      name: device.name,
      state: device.state,
    }));
}

type DevicectlDevice = {
  identifier?: string;
  deviceProperties?: { name?: string };
  hardwareProperties?: { udid?: string; platform?: string };
  connectionProperties?: { tunnelState?: string; pairingState?: string };
};

async function iosDevices(): Promise<Target[]> {
  let raw: string;
  try {
    raw = await run(
      "xcrun",
      ["devicectl", "list", "devices", "--json-output", "-", "--quiet"],
      { capture: true },
    );
  } catch {
    return [];
  }

  const start = raw.indexOf("{");
  if (start === -1) return [];
  let parsed: { result?: { devices?: DevicectlDevice[] } };
  try {
    parsed = JSON.parse(raw.slice(start)) as typeof parsed;
  } catch {
    return [];
  }

  return (parsed.result?.devices ?? [])
    .filter((device) => device.hardwareProperties?.platform === "iOS")
    .map((device) => ({
      kind: "device" as const,
      platform: "ios" as const,
      id: device.hardwareProperties?.udid ?? device.identifier ?? "",
      name: device.deviceProperties?.name ?? "iPhone",
      state: device.connectionProperties?.pairingState ?? "unknown",
    }))
    .filter((device) => device.id !== "");
}

export async function androidTargets(): Promise<Target[]> {
  let raw: string;
  try {
    raw = await run("adb", ["devices", "-l"], { capture: true });
  } catch {
    return [];
  }

  const out: Target[] = [];
  for (const line of raw.split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("*")) continue;
    const [serial, state, ...rest] = trimmed.split(/\s+/);
    if (serial === undefined || state === undefined) continue;
    if (state !== "device") continue;
    const model = rest
      .find((entry) => entry.startsWith("model:"))
      ?.slice("model:".length);
    out.push({
      kind: serial.startsWith("emulator-") ? "simulator" : "device",
      platform: "android",
      id: serial,
      name: model ?? serial,
      state,
    });
  }
  return out;
}

function describe(targets: readonly Target[]): string {
  return targets
    .map((target) => `  ${target.name}  (${target.kind}, ${target.id})`)
    .join("\n");
}

export function pick(
  targets: readonly Target[],
  wanted: string | undefined,
  prefer: "simulator" | "device" | undefined,
): Target {
  if (targets.length === 0) {
    throw new Error(
      prefer === "device"
        ? "flypath: no connected device found — plug one in, unlock it, and " +
            "trust this computer"
        : "flypath: no simulator or device is available",
    );
  }

  if (wanted !== undefined && wanted !== "") {
    const match = targets.find(
      (target) =>
        target.id === wanted ||
        target.name === wanted ||
        target.name.toLowerCase() === wanted.toLowerCase(),
    );
    if (!match) {
      throw new Error(
        `flypath: no target named "${wanted}". Available:\n${describe(targets)}`,
      );
    }
    return match;
  }

  const pool =
    prefer === undefined
      ? targets
      : targets.filter((target) => target.kind === prefer);
  if (pool.length === 0) {
    throw new Error(
      `flypath: no ${prefer} is available. Found:\n${describe(targets)}`,
    );
  }
  if (pool.length === 1) return pool[0] as Target;

  const booted = pool.find((target) => target.state === "Booted");
  if (booted) return booted;

  throw new Error(
    `flypath: more than one target is available; pass --device with one of ` +
      `these:\n${describe(pool)}`,
  );
}

export async function iosTargets(includeDevices: boolean): Promise<Target[]> {
  if (!includeDevices) return iosSimulators();
  const [simulators, devices] = await Promise.all([
    iosSimulators(),
    iosDevices(),
  ]);
  return [...devices, ...simulators];
}
