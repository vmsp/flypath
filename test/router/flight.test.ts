import { describe, expect, test } from "vitest";

import {
  documentPath,
  flightPath,
  isFlightPath,
} from "../../src/shared/flight.ts";

describe("flightPath", () => {
  test("names the root payload index.flight", () => {
    expect(flightPath("/")).toBe("/index.flight");
  });

  test("appends the suffix to a route path", () => {
    expect(flightPath("/about")).toBe("/about.flight");
    expect(flightPath("/legal/privacy")).toBe("/legal/privacy.flight");
  });

  test("normalizes before appending", () => {
    expect(flightPath("/about/")).toBe("/about.flight");
    expect(flightPath("about")).toBe("/about.flight");
  });
});

describe("documentPath", () => {
  test("round trips every shape", () => {
    for (const path of ["/", "/about", "/legal/privacy", "/p/1"]) {
      expect(documentPath(flightPath(path))).toBe(path);
    }
  });

  test("leaves a document path alone", () => {
    expect(documentPath("/about")).toBe("/about");
    expect(documentPath("/")).toBe("/");
  });
});

describe("isFlightPath", () => {
  test("is true only for the suffix", () => {
    expect(isFlightPath("/about.flight")).toBe(true);
    expect(isFlightPath("/index.flight")).toBe(true);
  });

  test("is false for a path that merely contains a dot", () => {
    expect(isFlightPath("/v1.2/about")).toBe(false);
    expect(isFlightPath("/about.flightplan")).toBe(false);
    expect(isFlightPath("/robots.txt")).toBe(false);
  });
});
