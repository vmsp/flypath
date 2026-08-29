"use client";

import { back } from "flypath";

import { colors } from "./vars.css.ts";

export default function Settings() {
  return (
    <>
      <title>Settings</title>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 20,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 24 }}>Settings</h1>
        <p style={{ color: colors.muted }}>
          This screen lives in the outer stack, so it covers the tab bar on web
          and on native.
        </p>
        <button
          onClick={back}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 8,
            color: "white",
            padding: 12,
          }}
        >
          <span style={{ color: "white" }}>back</span>
        </button>
      </main>
    </>
  );
}
