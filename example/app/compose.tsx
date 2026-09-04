import { listNotes, postNote } from "./actions.ts";
import BackLink from "./back-link.tsx";
import { colors } from "./vars.css.ts";

export default async function Compose() {
  const notes = await listNotes();

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
        <form
          action={postNote}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input
            name="note"
            placeholder="say something"
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
            post and close
          </button>
        </form>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {notes.map((note) => (
            <span key={note.id} style={{ color: colors.secondary }}>
              {note.author}: {note.body}
            </span>
          ))}
        </div>
        <BackLink>close</BackLink>
      </main>
    </>
  );
}
