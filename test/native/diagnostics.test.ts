import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  collector,
  fallback,
  gradleLabel,
  parseDiagnostic,
  tail,
  xcodeLabel,
} from "../../src/native/diagnostics.ts";

const root = path.join(import.meta.dirname, "fixtures", "project");
const flypath = path.join(import.meta.dirname, "fixtures", "flypath");

function fixture(name: string): string {
  return fs
    .readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")
    .replaceAll("${ROOT}", root)
    .replaceAll("${FLYPATH}", flypath);
}

function feed(tool: "xcode" | "gradle", output: string) {
  const build = collector(root, tool);
  const labels: string[] = [];
  for (const line of output.split("\n")) {
    const label = build.feed(line);
    if (label !== undefined) labels.push(label);
  }
  return { build, labels };
}

describe("xcodebuild", () => {
  const output = fixture("xcodebuild-failed.log");

  test("progress labels", () => {
    const { labels } = feed("xcode", output);
    expect(labels).toEqual([
      "Resolving packages",
      "Compiling FlypathRuntime.cpp",
      "Compiling Camera.swift",
      "Compiling Camera.swift",
      "Linking",
      "Signing",
    ]);
  });

  test("warnings are shown only when the project owns the file, once", () => {
    const { build } = feed("xcode", output);
    expect(build.warnings()).toEqual([
      {
        severity: "warning",
        file: path.join(root, "apple/Sources/Camera.swift"),
        line: 56,
        column: 15,
        text: "'devices()' was deprecated in iOS 10.0: Use AVCaptureDeviceDiscoverySession instead.",
      },
    ]);
  });

  test("errors name the file, line and column relative to the project", () => {
    const { build } = feed("xcode", output);
    expect(build.failure(output)).toEqual([
      "apple/Sources/Camera.swift:57:14",
      "cannot find type 'AVCaptureSesion' in scope",
    ]);
  });

  test("without a diagnostic, the failed-commands footer", () => {
    const footerOnly = output
      .split("\n")
      .filter((line) => !line.includes(": error: "))
      .join("\n");
    const { build } = feed("xcode", footerOnly);
    expect(build.failure(footerOnly)).toEqual([
      "The following build commands failed:",
      `SwiftCompile normal arm64 ${root}/apple/Sources/Camera.swift (in target 'ExampleNative' from project 'ExampleNative')`,
      `SwiftCompile normal arm64 Compiling\\ Camera.swift ${root}/apple/Sources/Camera.swift (in target 'ExampleNative' from project 'ExampleNative')`,
      "Building project App with scheme App and configuration Debug",
      "(3 failures)",
    ]);
  });

  test("file-less errors are always shown", () => {
    const { build } = feed(
      "xcode",
      "error: No profiles for 'dev.flypath.example' were found\n** BUILD FAILED **",
    );
    expect(build.failure("")).toEqual([
      "No profiles for 'dev.flypath.example' were found",
    ]);
  });

  test("a line that names no step leaves the label alone", () => {
    expect(xcodeLabel("    export ARCHS\\=arm64")).toBeUndefined();
    expect(xcodeLabel("ProcessInfoPlistFile /x/Info.plist")).toBeUndefined();
  });
});

describe("gradle", () => {
  const output = fixture("gradle-failed.log");

  test("progress labels from task names", () => {
    const { labels } = feed("gradle", output);
    expect(labels).toEqual([
      "Compiling Kotlin",
      "Compiling Kotlin",
      "Dexing",
      "Compiling Kotlin",
      "Compiling C++",
    ]);
    expect(gradleLabel("> Task :app:packageDebug")).toBe("Packaging");
    expect(gradleLabel("> Task :app:installDebug")).toBe("Installing");
  });

  test("Kotlin diagnostics, filtered by owner", () => {
    const { build } = feed("gradle", output);
    expect(build.warnings().map((entry) => entry.line)).toEqual([25]);
    expect(build.failure(output)).toEqual([
      "android/src/main/kotlin/Camera.kt:26:15",
      "Unresolved reference 'PreviewVeiw'.",
    ]);
  });

  test("without a diagnostic, what went wrong", () => {
    expect(fallback(output, "gradle")).toEqual([
      "Execution failed for task ':native:compileDebugKotlin'.",
      "> A failure occurred while executing org.jetbrains.kotlin.compilerRunner.GradleCompilerRunnerWithWorkers$GradleKotlinCompilerWorkAction",
      "   > Compilation error. See log for more details",
    ]);
  });
});

describe("parsing", () => {
  test("clang, swift, kotlin and C++ through Gradle", () => {
    expect(
      parseDiagnostic("/a/b.mm:3:4: fatal error: 'x.h' file not found"),
    ).toMatchObject({ severity: "error", file: "/a/b.mm", line: 3 });
    expect(
      parseDiagnostic("C/C++: /a/hash.cpp:10:5: error: use of undeclared x"),
    ).toMatchObject({ severity: "error", file: "/a/hash.cpp", line: 10 });
    expect(parseDiagnostic("e: /a/B.kt: (12, 5): Unresolved x")).toMatchObject({
      severity: "error",
      file: "/a/B.kt",
      line: 12,
      column: 5,
    });
    expect(parseDiagnostic("/a/b.swift:1:1: note: here")).toBeUndefined();
    expect(parseDiagnostic("warning: Run script build phase")).toBeUndefined();
  });

  test("the tail fallback keeps the last lines", () => {
    const output = Array.from({ length: 30 }, (_, at) => `line ${String(at)}`)
      .concat(["", ""])
      .join("\n");
    expect(tail(output)).toHaveLength(20);
    expect(tail(output).at(-1)).toBe("line 29");
    expect(fallback(output, "xcode")).toEqual(tail(output));
  });
});
