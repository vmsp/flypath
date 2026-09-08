import { currentJob, db } from "flypath";

import { sendMentionEmail, sendWelcomeEmail } from "./mail.tsx";

const HANDLE = /@([a-z0-9_]+)/gi;

export async function notifyMentions(noteId: number): Promise<number> {
  const note = await db()
    .from("notes")
    .where("id", "=", noteId)
    .select("body")
    .first();
  if (!note) return 0;

  const handles = [...note.body.matchAll(HANDLE)].map((match) =>
    String(match[1]).toLowerCase(),
  );
  if (handles.length === 0) return 0;

  const mentioned = await db()
    .from("users")
    .where("handle", "in", handles)
    .select("id", "name", "email");
  if (mentioned.length === 0) return 0;

  await db()
    .into("mentions")
    .insert(mentioned.map((user) => ({ noteId, userId: user.id })))
    .onConflict(["noteId", "userId"])
    .doNothing();

  for (const user of mentioned) await sendMentionEmail(user, noteId);

  console.log(
    `flypath: job ${String(currentJob().id)} noted ${String(
      mentioned.length,
    )} mention(s) on note ${String(noteId)}`,
  );
  return mentioned.length;
}

export async function sendWelcome(userId: number): Promise<void> {
  const user = await db()
    .from("users")
    .where("id", "=", userId)
    .select("name", "email")
    .first();
  if (!user) return;
  await sendWelcomeEmail(user);
}

export async function pruneNotes(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const { count } = await db().delete("notes").where("createdAt", "<", cutoff);
  console.log(
    `flypath: pruned ${String(count)} note(s) older than ${String(days)} days`,
  );
  return count;
}
