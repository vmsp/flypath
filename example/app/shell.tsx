import type { ReactNode } from "react";

import { colors } from "./vars.css.ts";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: colors.surface,
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: "100vh",
      }}
    >
      {children}
    </div>
  );
}
