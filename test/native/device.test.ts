import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { Target } from "../../src/native/device.ts";
import { pick, resolveHost } from "../../src/native/device.ts";
import {
  hasSigning,
  keystoreMissing,
} from "../../src/native/release-android.ts";
import { exportOptions } from "../../src/native/release-ios.ts";

function target(
  name: string,
  kind: "simulator" | "device",
  state = "Shutdown",
): Target {
  return { kind, platform: "ios", id: `id-${name}`, name, state };
}

describe("pick", () => {
  test("takes the only candidate", () => {
    expect(
      pick([target("iPhone 16", "simulator")], undefined, undefined).name,
    ).toBe("iPhone 16");
  });

  test("matches by name, case insensitively, and by id", () => {
    const targets = [
      target("iPhone 16", "simulator"),
      target("Pixel", "device"),
    ];
    expect(pick(targets, "Pixel", undefined).kind).toBe("device");
    expect(pick(targets, "pixel", undefined).kind).toBe("device");
    expect(pick(targets, "id-Pixel", undefined).kind).toBe("device");
  });

  test("prefers a booted candidate over listing them", () => {
    const targets = [
      target("iPhone 16", "simulator"),
      target("iPhone 17", "simulator", "Booted"),
    ];
    expect(pick(targets, undefined, undefined).name).toBe("iPhone 17");
  });

  test("lists the candidates rather than guessing", () => {
    const targets = [
      target("iPhone 16", "simulator"),
      target("iPhone 17", "simulator"),
    ];
    expect(() => pick(targets, undefined, undefined)).toThrow(
      /More than one target/,
    );
  });

  test("names what it has when the wanted target is not there", () => {
    expect(() =>
      pick([target("iPhone 16", "simulator")], "Nexus", undefined),
    ).toThrow(/No target named "Nexus"/);
  });

  test("says so when nothing is connected", () => {
    expect(() => pick([], undefined, "device")).toThrow(/No connected device/);
    expect(() => pick([], undefined, undefined)).toThrow(/No simulator/);
  });

  test("narrows to the preferred kind", () => {
    const targets = [
      target("iPhone 16", "simulator"),
      target("Vitor", "device"),
    ];
    expect(pick(targets, undefined, "device").name).toBe("Vitor");
    expect(() =>
      pick([target("iPhone 16", "simulator")], undefined, "device"),
    ).toThrow(/No device is available/);
  });
});

describe("resolveHost", () => {
  test("takes the override as given", () => {
    expect(resolveHost("10.0.0.5")).toBe("10.0.0.5");
  });

  test("falls back to a LAN address, never to localhost", () => {
    const resolved = resolveHost(undefined);
    expect(resolved).not.toBe("localhost");
    expect(resolved).toMatch(/^\d{1,3}(?:\.\d{1,3}){3}$/);
  });
});

describe("exportOptions", () => {
  test("names the distribution method", () => {
    const plist = exportOptions({
      distribution: "app-store",
      teamId: undefined,
      upload: false,
    });
    expect(plist).toContain("<key>method</key>");
    expect(plist).toContain("<string>app-store</string>");
    expect(plist).not.toContain("<key>destination</key>");
  });

  test("carries the team when there is one", () => {
    const plist = exportOptions({
      distribution: "ad-hoc",
      teamId: "ABCDE12345",
      upload: false,
    });
    expect(plist).toContain("<string>ABCDE12345</string>");
    expect(plist).toContain("<string>ad-hoc</string>");
  });

  test("asks xcodebuild to upload when told to", () => {
    const plist = exportOptions({
      distribution: "app-store",
      teamId: "ABCDE12345",
      upload: true,
    });
    expect(plist).toContain("<key>destination</key>");
    expect(plist).toContain("<string>upload</string>");
  });
});

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "flypath-signing-"));
  fs.mkdirSync(path.join(root, "android"), { recursive: true });
  delete process.env["FLYPATH_ANDROID_STOREFILE"];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env["FLYPATH_ANDROID_STOREFILE"];
});

describe("android signing", () => {
  test("is missing when there is no properties file", () => {
    expect(hasSigning(root)).toBe(false);
  });

  test("is missing when a key is absent", () => {
    fs.writeFileSync(
      path.join(root, "android", "keystore.properties"),
      "storeFile=release.keystore\nstorePassword=x\n",
    );
    expect(hasSigning(root)).toBe(false);
  });

  test("is present when all four keys are there", () => {
    fs.writeFileSync(
      path.join(root, "android", "keystore.properties"),
      "storeFile=release.keystore\nstorePassword=x\nkeyAlias=a\nkeyPassword=y\n",
    );
    expect(hasSigning(root)).toBe(true);
  });

  test("takes the environment as an answer for CI", () => {
    process.env["FLYPATH_ANDROID_STOREFILE"] = "/tmp/release.keystore";
    expect(hasSigning(root)).toBe(true);
  });

  test("names all four keys and the keytool line when it is missing", () => {
    const message = keystoreMissing(root);
    for (const key of [
      "storeFile",
      "storePassword",
      "keyAlias",
      "keyPassword",
    ]) {
      expect(message).toContain(key);
    }
    expect(message).toContain("keytool -genkeypair");
  });
});
