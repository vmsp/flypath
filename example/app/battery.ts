"use native";

import type { NativeComponent } from "flypath";

export interface WebViewProps {
  url: string;
  onLoad?: (title: string) => void;
}

export declare function printHello(): void;

export declare function batteryLevel(): Promise<number>;

export declare function greet(name: string, times: number): string;

export declare const WebView: NativeComponent<WebViewProps>;
