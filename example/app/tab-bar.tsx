import { TabBar } from "flypath";
import type { ReactNode } from "react";

export default function Tabs({ children }: { children: ReactNode }) {
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
      <TabBar />
    </div>
  );
}
