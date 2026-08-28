import { entries, signForm } from "./actions.ts";
import { WebView } from "./battery.ts";
import Counter from "./counter.tsx";
import Guestbook from "./guestbook.tsx";
import Loaded from "./loaded.tsx";
import NavDemo from "./nav-demo.tsx";
import { colors, dark } from "./vars.css.ts";

export default async function Profile() {
  const signatures = await entries();

  return (
    <>
      <title>Profile</title>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: { default: 8, "@media (min-width: 600px)": 32 },
        }}
      >
        <h1 style={{ color: colors.primary }}>Profile</h1>
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
        <form
          action={signForm}
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

        <NavDemo />

        <Guestbook />

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {signatures.map((name, index) => (
            <span key={`${name}-${index}`} style={{ color: colors.secondary }}>
              {name}
            </span>
          ))}
        </div>

        <Loaded />

        <WebView style={{ height: 160 }} url="https://react.dev" />

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
    </>
  );
}
