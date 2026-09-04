"use client";

import { useState } from "react";

import type { CameraFacing } from "./camera.ts";
import { CameraPreview } from "./camera.ts";
import { colors } from "./vars.css.ts";

export default function Viewfinder() {
  const [facing, setFacing] = useState<CameraFacing>("back");

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        gap: 12,
        padding: 16,
      }}
    >
      <h1 style={{ color: colors.text, fontSize: 24 }}>Camera</h1>
      <CameraPreview
        facing={facing}
        style={{ borderRadius: 12, height: 320 }}
      />
      <button
        onClick={() => setFacing(facing === "back" ? "front" : "back")}
        style={{
          backgroundColor: colors.primary,
          borderRadius: 10,
          color: "#fff",
          padding: 14,
        }}
      >
        facing: {facing}
      </button>
    </main>
  );
}
