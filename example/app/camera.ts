"use native";

import type { NativeComponent } from "flypath";

export type CameraFacing = "front" | "back";

export interface CameraPreviewProps {
  facing: CameraFacing;
}

export declare const CameraPreview: NativeComponent<CameraPreviewProps>;
