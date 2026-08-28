"use client";

import { href, useParams, usePathname } from "flypath";

import { colors } from "./vars.css.ts";

export default function NavDemo() {
  const pathname = usePathname();
  const params = useParams();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: colors.muted }}>
        at {pathname} {JSON.stringify(params)}
      </span>
      <a
        href={href("/p/:id", { id: "1" })}
        style={{
          backgroundColor: colors.secondary,
          borderRadius: 8,
          color: "white",
          padding: 12,
          textAlign: "center",
          textDecorationLine: "none",
        }}
      >
        open the first post
      </a>
      <a
        href="/settings"
        style={{
          backgroundColor: colors.primary,
          borderRadius: 8,
          color: "white",
          padding: 12,
          textAlign: "center",
          textDecorationLine: "none",
        }}
      >
        settings (covers the tab bar)
      </a>
      <a
        href="/compose"
        style={{
          borderColor: colors.border,
          borderRadius: 8,
          borderStyle: "solid",
          borderWidth: 1,
          color: colors.text,
          padding: 12,
          textAlign: "center",
          textDecorationLine: "none",
        }}
      >
        compose (modal above the tab bar)
      </a>
    </div>
  );
}
