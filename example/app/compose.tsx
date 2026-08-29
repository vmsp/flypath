import BackLink from "./back-link.tsx";
import { colors } from "./vars.css.ts";

export default function Compose() {
  return (
    <>
      <title>Compose</title>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 20,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 22 }}>Compose</h1>
        <p style={{ color: colors.muted }}>
          Presented above the outer stack, so it covers the tab bar too.
        </p>
        <BackLink>close</BackLink>
      </main>
    </>
  );
}
