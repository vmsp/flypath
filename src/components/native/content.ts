"use client";

import { useEffect, useState } from "react";

import { contentAt, subscribe } from "../../runtime/native-content.ts";
import type { Content } from "./navigator-context.ts";
import { ABSENT } from "./navigator-context.ts";

type Tracked = { key: string; value: Content | undefined };

export function useContent(key: string): Content {
  const [tracked, setTracked] = useState<Tracked>(() => ({
    key,
    value: contentAt(key),
  }));

  if (tracked.key !== key) setTracked({ key, value: contentAt(key) });

  useEffect(() => {
    setTracked({ key, value: contentAt(key) });
    return subscribe(key, (value) => {
      setTracked({ key, value });
    });
  }, [key]);

  return (tracked.key === key ? tracked.value : contentAt(key)) ?? ABSENT;
}
