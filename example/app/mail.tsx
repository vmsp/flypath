import { db, href, Preview, sendMail, Subject } from "flypath";
import type { ReactNode } from "react";

import { colors } from "./vars.css.ts";

const card = {
  borderColor: colors.border,
  borderRadius: 12,
  borderStyle: "solid",
  borderWidth: 1,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 16,
} as const;

export function WelcomeBody({ name }: { name: string }): ReactNode {
  return (
    <div style={{ backgroundColor: colors.surface, padding: 24 }}>
      <h1 style={{ color: colors.text, fontSize: 24 }}>Welcome, {name}!</h1>
      <p style={{ color: colors.muted }}>
        Everything on this page is the same component the app renders.
      </p>
      <a href={href("/settings")} style={{ color: colors.primary }}>
        Finish your profile
      </a>
    </div>
  );
}

function WelcomeEmail({ name }: { name: string }): ReactNode {
  return (
    <>
      <Preview>Your account is ready.</Preview>
      <Subject>Welcome to Flypath!</Subject>
      <meta content="Flypath" name="author" />
      <WelcomeBody name={name} />
    </>
  );
}

async function MentionEmail({
  name,
  noteId,
}: {
  name: string;
  noteId: number;
}): Promise<ReactNode> {
  const note = await db()
    .from("notes")
    .join("users", "users.id", "notes.authorId")
    .where("notes.id", "=", noteId)
    .select("notes.body", "users.name as author")
    .first();

  return (
    <div style={{ backgroundColor: colors.surface, padding: 24 }}>
      <Preview>{note ? `${note.author} mentioned you` : "New mention"}</Preview>
      <Subject>You were mentioned on Flypath</Subject>
      <h1 style={{ color: colors.text, fontSize: 24 }}>Hi {name},</h1>
      <p style={{ color: colors.muted }}>
        {note?.author ?? "Someone"} mentioned you in a note.
      </p>
      <div style={card}>
        <span style={{ color: colors.text }}>{note?.body ?? ""}</span>
      </div>
      <a href={href("/")} style={{ color: colors.primary }}>
        Read it on Flypath
      </a>
    </div>
  );
}

export async function sendWelcomeEmail(user: {
  email: string;
  name: string;
}): Promise<void> {
  await sendMail({
    to: { email: user.email, name: user.name },
    content: <WelcomeEmail name={user.name} />,
  });
}

export async function sendMentionEmail(
  user: { email: string; name: string },
  noteId: number,
): Promise<void> {
  await sendMail({
    to: { email: user.email, name: user.name },
    content: <MentionEmail name={user.name} noteId={noteId} />,
  });
}
