"use server";

import { cookies, db, navigate, revalidate } from "flypath";

import { addLike } from "./posts.ts";
import type { User } from "./session.ts";
import { findUser, session, SESSION_COOKIE, visitor } from "./session.ts";

export type Note = { id: number; author: string; body: string };

export async function entries(): Promise<string[]> {
  const rows = await db()
    .from("signatures")
    .select("id", "name")
    .orderBy("id", "asc");
  return rows.map((row) => row.name);
}

export async function sign(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return "name required";
  await db().into("signatures").insert({ name });
  return null;
}

export async function signForm(formData: FormData): Promise<void> {
  await sign(null, formData);
}

export async function listNotes(): Promise<Note[]> {
  return db()
    .from("notes")
    .join("users", "users.id", "notes.authorId")
    .select("notes.id", "users.name as author", "notes.body")
    .orderBy("id", "asc");
}

export async function postNote(formData: FormData): Promise<void> {
  const body = String(formData.get("note") ?? "").trim();
  if (body === "") return;
  await db().into("notes").insert({ authorId: session().id, body });
  navigate("back");
}

export async function signIn(formData: FormData): Promise<void> {
  const handle = String(formData.get("user") ?? "")
    .trim()
    .toLowerCase();
  const user: User | undefined = await findUser(handle);
  if (!user) return;

  cookies.set(SESSION_COOKIE, user.handle, {
    httpOnly: true,
    maxAge: 604800,
    path: "/",
    sameSite: "lax",
  });
  navigate("/settings");
}

export async function signOut(): Promise<void> {
  cookies.clear(SESSION_COOKIE, { path: "/" });
  revalidate.reset();
  navigate("/");
}

export async function likePost(id: number): Promise<number> {
  revalidate.none();
  const user = visitor();
  if (!user) return 0;
  return addLike(id, user.id);
}
