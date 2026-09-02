import { signIn } from "./actions.ts";
import { visitor } from "./session.ts";
import { colors } from "./vars.css.ts";

export default function Login() {
  const current = visitor();

  return (
    <>
      <title>Sign in</title>
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
        <h1 style={{ color: colors.text, fontSize: 24 }}>Sign in</h1>
        <p style={{ color: colors.muted }}>
          {current
            ? `Already signed in as ${current.name}.`
            : "Try ada or grace — the guard on /settings sent you here."}
        </p>
        <form
          action={signIn}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input
            name="user"
            placeholder="ada"
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
            sign in
          </button>
        </form>
      </main>
    </>
  );
}
