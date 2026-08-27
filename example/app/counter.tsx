"use client";

import { useEffect, useState } from "react";

import { batteryLevel, greet, printHello } from "./battery.ts";
import { fingerprint } from "./hash.ts";
import { colors, spin } from "./vars.css.ts";

function shout(text: string): string {
  "use native";
  return `${text.toUpperCase()}!`;
}

export default function Counter() {
  const [n, setN] = useState(0);
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("");
  const [battery, setBattery] = useState("battery: ?");

  useEffect(() => {
    printHello();
    batteryLevel().then(
      (level) =>
        setBattery(
          `${shout(greet("native", 1))} — battery ${Math.round(level * 100)}% — ${fingerprint("flypath")}`,
        ),
      (error: unknown) => setBattery(String(error)),
    );
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button
        onClick={() => setN(n + 1)}
        style={{
          backgroundColor: colors.secondary,
          borderRadius: 8,
          color: { default: colors.primary, ":active": colors.secondary },
          padding: 12,
          animation: n > 9 ? `${spin} 1s linear` : undefined,
        }}
      >
        count: {n}
      </button>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setGreeting(name === "" ? "hello, stranger" : `hello, ${name}`);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <input
          onChange={(event) => setName(event.target.value)}
          placeholder="your name"
          style={{
            borderColor: colors.primary,
            borderRadius: 6,
            borderStyle: "solid",
            borderWidth: 1,
            padding: 8,
          }}
          value={name}
        />
        <textarea
          onChange={(event) => setGreeting(event.target.value)}
          rows={3}
          style={{
            borderColor: colors.secondary,
            borderRadius: 6,
            borderStyle: "solid",
            borderWidth: 1,
            padding: 8,
          }}
          value={greeting}
        />
        <button
          style={{
            backgroundColor: colors.primary,
            borderRadius: 8,
            color: "white",
            padding: 12,
          }}
          type="submit"
        >
          greet
        </button>
      </form>

      <button
        style={{
          backgroundColor: colors.secondary,
          borderRadius: 8,
          color: "white",
          padding: 12,
        }}
      >
        {battery}
      </button>

      <a href="https://react.dev">react.dev</a>
    </div>
  );
}
