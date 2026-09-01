"use client";

import { navigate } from "flypath";
import type { ReactNode } from "react";

import { colors } from "./vars.css.ts";

export default function BackLink({ children }: { children: ReactNode }) {
  return (
    <a
      onClick={() => navigate("back")}
      style={{ color: colors.primary, textDecorationLine: "none" }}
    >
      {children}
    </a>
  );
}
