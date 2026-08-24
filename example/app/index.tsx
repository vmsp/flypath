import { entries, sign } from "./actions.ts";
import Counter from "./counter.tsx";
import Guestbook from "./guestbook.tsx";
import { colors, dark, spin } from "./vars.css.ts";

export default async function Index() {
  const signatures = await entries();

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
      <form
        action={sign.bind(null, null)}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <input
          name="name"
          placeholder="your name (server)"
          style={{
            borderColor: colors.primary,
            borderRadius: 6,
            borderStyle: "solid",
            borderWidth: 1,
            padding: 8,
          }}
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
          sign
        </button>
      </form>

      <Guestbook />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {signatures.map((name, index) => (
          <span key={`${name}-${index}`} style={{ color: colors.secondary }}>
            {name}
          </span>
        ))}
      </div>

      <Counter />
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
