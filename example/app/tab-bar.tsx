"use client";

import { useBranches } from "flypath";
import type { ReactNode } from "react";

import { colors } from "./vars.css.ts";

const LABELS: Record<string, string> = {
  "/": "Home",
  "/explore": "Explore",
  "/me": "Profile",
};

const ICONS: Record<string, string> = {
  "/": "◉",
  "/explore": "◈",
  "/me": "◐",
};

export default function Tabs({ children }: { children: ReactNode }) {
  const tabs = useBranches();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
        {children}
      </div>
      <nav
        style={{
          borderTopColor: colors.border,
          borderTopStyle: "solid",
          borderTopWidth: 1,
          display: "flex",
          flexDirection: "row",
          paddingBottom: 12,
          paddingTop: 12,
        }}
      >
        {tabs.map((tab) => (
          <a
            href={tab.href}
            key={tab.key}
            style={{
              alignItems: "center",
              color: tab.active ? colors.primary : colors.muted,
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              fontWeight: tab.active ? "600" : "400",
              gap: 2,
              textAlign: "center",
              textDecorationLine: "none",
            }}
            {...(tab.active ? { "aria-current": "page" } : {})}
          >
            <span style={{ fontSize: 18 }}>{ICONS[tab.href] ?? "○"}</span>
            <span style={{ fontSize: 12 }}>{LABELS[tab.href] ?? tab.href}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
