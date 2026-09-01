"use server";

import { navigate } from "flypath";

let signatures: string[] = [];

let notes: string[] = [];

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

export async function listNotes(): Promise<string[]> {
  return notes;
}

export async function postNote(formData: FormData): Promise<void> {
  const note = String(formData.get("note") ?? "").trim();
  if (note === "") return;
  notes = [...notes, note];
  navigate("back");
}
