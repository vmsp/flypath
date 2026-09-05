"use client";

import { navigate } from "flypath";
import type { ReactNode } from "react";

import { colors } from "./vars.css.ts";

export default function BackLink({ children }: { children: ReactNode }) {
  return (
    <button
      onClick={() => navigate("back")}
      style={{
        backgroundColor: "transparent",
        borderWidth: 0,
        color: colors.primary,
        padding: 0,
      }}
      type="button"
    >
      {children}
    </button>
  );
}
