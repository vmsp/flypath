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
    </div>
  );
}
