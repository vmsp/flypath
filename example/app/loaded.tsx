"use client";

import { useState } from "react";

import { WebView } from "./battery.ts";
import { colors } from "./vars.css.ts";

export default function Loaded() {
  const [title, setTitle] = useState("waiting for onLoad");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: colors.secondary }}>{title}</span>
      <WebView
        onLoad={(value) => setTitle(`loaded: ${value}`)}
        style={{ height: 200 }}
        url="https://react.dev"
      />
    </div>
  );
}
