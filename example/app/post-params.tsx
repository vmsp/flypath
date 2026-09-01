"use client";

import { navigate, params, query } from "flypath";

import { colors } from "./vars.css.ts";

export default function PostParams() {
  const id = params("id");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ color: colors.muted }}>
        client id {id} · ref {query("ref") ?? "none"}
      </span>
      <button
        onClick={() =>
          navigate("/p/:id", { id: String(Number(id) + 1), ref: "next" })
        }
        style={{
          backgroundColor: colors.secondary,
          borderRadius: 8,
          padding: 12,
        }}
      >
        <span style={{ color: "white" }}>next post</span>
      </button>
    </div>
  );
}
