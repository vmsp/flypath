import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing } from "react-native";

import type { Animation } from "../../styles/native.ts";
import type { Env, Style } from "./resolve.ts";
import { resolveStyle } from "./resolve.ts";

const TRANSFORM = "([\\w]+)\\(([^)]*)\\)";

const NATIVE_SAFE: ReadonlySet<string> = new Set(["opacity", "transform"]);

function parseTransform(value: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (typeof value !== "string") return out;
  const pattern = new RegExp(TRANSFORM, "g");
  let match = pattern.exec(value);
  while (match !== null) {
    const fn = match[1] as string;
    const raw = (match[2] ?? "").trim();
    if (raw.endsWith("deg") || raw.endsWith("rad")) out[fn] = raw;
    else if (raw.endsWith("px")) out[fn] = Number(raw.slice(0, -2));
    else out[fn] = Number(raw);
    match = pattern.exec(value);
  }
  return out;
}

function easingFor(name: string): (value: number) => number {
  switch (name) {
    case "linear":
      return Easing.linear;
    case "ease-in":
      return Easing.in(Easing.ease);
    case "ease-out":
      return Easing.out(Easing.ease);
    case "ease-in-out":
      return Easing.inOut(Easing.ease);
    case "step-start":
      return Easing.step0;
    case "step-end":
      return Easing.step1;
    default:
      return Easing.ease;
  }
}

type Track = {
  offsets: number[];
  values: (string | number)[];
};

function collect(frames: { at: number; style: Style }[]): {
  plain: Map<string, Track>;
  transform: Map<string, Track>;
} {
  const plain = new Map<string, Track>();
  const transform = new Map<string, Track>();

  const push = (
    target: Map<string, Track>,
    key: string,
    at: number,
    value: string | number,
  ) => {
    const track = target.get(key) ?? { offsets: [], values: [] };
    track.offsets.push(at);
    track.values.push(value);
    target.set(key, track);
  };

  for (const frame of frames) {
    for (const [property, value] of Object.entries(frame.style)) {
      if (property === "transform") {
        for (const [fn, next] of Object.entries(parseTransform(value))) {
          push(transform, fn, frame.at, next);
        }
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number") continue;
      push(plain, property, frame.at, value);
    }
  }
  return { plain, transform };
}

export type AnimatedStyle = {
  style: Style;
  useNativeDriver: boolean;
};

export function useAnimation(
  animation: Animation | undefined,
  env: Env,
): AnimatedStyle | undefined {
  const progress = useRef(new Animated.Value(0)).current;

  const built = useMemo(() => {
    if (!animation) return undefined;
    const frames = animation.frames.map((frame) => ({
      at: frame.at,
      style: resolveStyle(frame.style, env),
    }));
    const { plain, transform } = collect(frames);

    const useNativeDriver = [...plain.keys()].every((key) =>
      NATIVE_SAFE.has(key),
    );

    const style: Style = {};
    for (const [property, track] of plain) {
      if (track.offsets.length < 2) {
        style[property] = track.values[0];
        continue;
      }
      style[property] = progress.interpolate({
        inputRange: track.offsets,
        outputRange: track.values as number[],
      });
    }

    const transforms: Record<string, unknown>[] = [];
    for (const [fn, track] of transform) {
      if (track.offsets.length < 2) {
        transforms.push({ [fn]: track.values[0] });
        continue;
      }
      transforms.push({
        [fn]: progress.interpolate({
          inputRange: track.offsets,
          outputRange: track.values as number[],
        }),
      });
    }
    if (transforms.length > 0) style["transform"] = transforms;

    return { style, useNativeDriver };
  }, [animation, env, progress]);

  const duration = animation?.duration ?? 0;
  const delay = animation?.delay ?? 0;
  const easing = animation?.easing ?? "ease";
  const iterations = animation?.iterations ?? 1;
  const reduceMotion = env.reduceMotion;
  const useNativeDriver = built?.useNativeDriver ?? false;

  useEffect(() => {
    if (!animation) return;
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const timing = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: easingFor(easing),
      useNativeDriver,
    });
    const loop = Animated.loop(timing, {
      iterations: iterations === Infinity ? -1 : iterations,
    });
    loop.start();
    return () => loop.stop();
  }, [
    animation,
    delay,
    duration,
    easing,
    iterations,
    progress,
    reduceMotion,
    useNativeDriver,
  ]);

  return built;
}
