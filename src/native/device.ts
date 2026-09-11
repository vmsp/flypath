import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as env from "../shared/env.ts";
import { FlypathError } from "../shared/errors.ts";
import { run } from "./exec.ts";

export type Target = {
  kind: "simulator" | "device";
  platform: "ios" | "android";
  id: string;
  name: string;
  state: string;
};

export function androidHome(): string {
  return (
    env.androidHome() ?? path.join(os.homedir(), "Library", "Android", "sdk")
  );
}

export function tool(name: string): string {
  const candidate = path.join(androidHome(), "platform-tools", name);
  return fs.existsSync(candidate) ? candidate : name;
}

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
    throw new FlypathError("Could not find a LAN address for this machine", {
      hint:
        "A device cannot reach localhost. Pass --host with the address the " +
        "device should use",
    });
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
    raw = await run("xcrun", ["simctl", "list", "devices", "-j"]);
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
    raw = await run("xcrun", [
      "devicectl",
      "list",
      "devices",
      "--json-output",
      "-",
      "--quiet",
    ]);
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
    raw = await run(tool("adb"), ["devices", "-l"]);
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
      ?.slice("model:".length)
      .replaceAll("_", " ");
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

function describe(targets: readonly Target[]): string[] {
  const width = Math.max(...targets.map((target) => target.name.length)) + 2;
  return targets.map(
    (target) => `${target.name.padEnd(width)}${target.kind} · ${target.id}`,
  );
}

export function pick(
  targets: readonly Target[],
  wanted: string | undefined,
  prefer: "simulator" | "device" | undefined,
): Target {
  if (targets.length === 0) {
    throw prefer === "device"
      ? new FlypathError("No connected device found", {
          hint: "Plug one in, unlock it, and trust this computer",
        })
      : new FlypathError("No simulator or device is available", {
          hint: "Boot a simulator or an emulator, or connect a device",
        });
  }

  if (wanted !== undefined && wanted !== "") {
    const match = targets.find(
      (target) =>
        target.id === wanted ||
        target.name === wanted ||
        target.name.toLowerCase() === wanted.toLowerCase(),
    );
    if (!match) {
      throw new FlypathError(`No target named "${wanted}"`, {
        hint: "Pass --device with one of these",
        details: describe(targets),
      });
    }
    return match;
  }

  const pool =
    prefer === undefined
      ? targets
      : targets.filter((target) => target.kind === prefer);
  if (pool.length === 0) {
    throw new FlypathError(`No ${String(prefer)} is available`, {
      details: describe(targets),
    });
  }
  if (pool.length === 1) return pool[0] as Target;

  const booted = pool.find((target) => target.state === "Booted");
  if (booted) return booted;

  throw new FlypathError("More than one target is available", {
    hint: "Pass --device with one of these",
    details: describe(pool),
  });
}

export async function iosTargets(includeDevices: boolean): Promise<Target[]> {
  if (!includeDevices) return iosSimulators();
  const [simulators, devices] = await Promise.all([
    iosSimulators(),
    iosDevices(),
  ]);
  return [...devices, ...simulators];
}
