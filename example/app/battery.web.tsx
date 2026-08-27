import type { StyleProp } from "flypath";
import { createElement } from "react";

import type { WebViewProps } from "./battery.ts";

export function printHello(): void {
  console.log("Hello!");
}

export async function batteryLevel(): Promise<number> {
  const api = navigator as unknown as {
    getBattery?: () => Promise<{ level: number }>;
  };
  if (!api.getBattery) return 1;
  return (await api.getBattery()).level;
}

export function greet(name: string, times: number): string {
  return Array.from({ length: times }, () => `hello, ${name}`).join(" ");
}

export function WebView({
  onLoad,
  style,
  url,
}: WebViewProps & { style?: StyleProp }) {
  return (
    <div style={style}>
      {createElement("iframe", {
        onLoad: () => onLoad?.(url),
        src: url,
        style: { border: "none", height: "100%", width: "100%" },
      })}
    </div>
  );
}
