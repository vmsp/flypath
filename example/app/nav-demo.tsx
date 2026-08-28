"use client";

import { href, useParams, usePathname, useRouter } from "flypath";

import { colors } from "./vars.css.ts";

export default function NavDemo() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: colors.muted }}>
        at {pathname} {JSON.stringify(params)}
      </span>
      <button
        onClick={() => router.push(href("/p/:id", { id: "1" }))}
        style={{
          backgroundColor: colors.secondary,
          borderRadius: 8,
          color: "white",
          padding: 12,
        }}
      >
        open the first post
      </button>
      <button
        onClick={() => router.refresh()}
        style={{
          backgroundColor: colors.muted,
          borderRadius: 8,
          color: "white",
          padding: 12,
        }}
      >
        refresh
      </button>
    </div>
  );
}
