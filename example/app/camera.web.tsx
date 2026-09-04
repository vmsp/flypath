import type { StyleProp } from "flypath";
import { createElement, useEffect, useRef } from "react";

import type { CameraPreviewProps } from "./camera.ts";

export function CameraPreview({
  facing,
  style,
}: CameraPreviewProps & { style?: StyleProp }) {
  const element = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;

    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: facing === "front" ? "user" : "environment" },
      })
      .then((value) => {
        if (stopped) {
          for (const track of value.getTracks()) track.stop();
          return;
        }
        stream = value;
        if (element.current) element.current.srcObject = value;
      })
      .catch(() => undefined);

    return () => {
      stopped = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [facing]);

  return (
    <div style={style}>
      {createElement("video", {
        autoPlay: true,
        muted: true,
        playsInline: true,
        ref: element,
        style: { height: "100%", objectFit: "cover", width: "100%" },
      })}
    </div>
  );
}
