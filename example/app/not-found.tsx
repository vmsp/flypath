import { colors } from "./vars.css.ts";

export default function NotFound() {
  return (
    <>
      <title>Nothing here</title>
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: 12,
          overflow: "auto",
          padding: 24,
        }}
      >
        <h1 style={{ color: colors.text, fontSize: 24 }}>Nothing here</h1>
        <a href="/" style={{ color: colors.primary }}>
          go home
        </a>
      </main>
    </>
  );
}
