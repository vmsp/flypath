import { colors, dark, spin } from "./vars.css.ts";

export default function Index() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: { default: 8, "@media (min-width: 600px)": 32 },
      }}
    >
      <h1 style={{ color: colors.primary }}>Hello World!</h1>
      <p
        style={{
          color: { default: colors.primary, ":hover": colors.secondary },
        }}
      >
        Conditional color
      </p>
      <div style={[dark, { padding: 16 }]}>
        <h2 style={{ color: colors.primary }}>Themed</h2>
      </div>
      <span style={{ animation: `${spin} 1s linear infinite` }}>spin</span>
      <button
        style={{
          backgroundColor: { default: colors.secondary, ":active": "black" },
          borderRadius: 8,
          padding: 12,
        }}
      >
        <span style={{ color: "white" }}>Press me</span>
      </button>
    </div>
  );
}
