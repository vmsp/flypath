"use server";

import { cookies, navigate } from "flypath";

import type { User } from "./session.ts";
import { findUser, session, SESSION_COOKIE } from "./session.ts";

type Note = { author: string; body: string };

let signatures: string[] = [];

let notes: Note[] = [];

export async function entries(): Promise<string[]> {
  return signatures;
}

export async function sign(
  _previous: string | null,
  formData: FormData,
): Promise<string | null> {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return "name required";
  signatures = [...signatures, name];
  return null;
}

export async function signForm(formData: FormData): Promise<void> {
  await sign(null, formData);
}

export async function listNotes(): Promise<Note[]> {
  return notes;
}

export async function postNote(formData: FormData): Promise<void> {
  const body = String(formData.get("note") ?? "").trim();
  if (body === "") return;
  notes = [...notes, { author: session().name, body }];
  navigate("back");
}

export async function signIn(formData: FormData): Promise<void> {
  const id = String(formData.get("user") ?? "")
    .trim()
    .toLowerCase();
  const user: User | undefined = findUser(id);
  if (!user) return;

  cookies.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    maxAge: 604800,
    path: "/",
    sameSite: "lax",
  });
  navigate("/settings");
}

export async function signOut(): Promise<void> {
  cookies.clear(SESSION_COOKIE, { path: "/" });
  navigate("/");
}
