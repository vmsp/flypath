"use server";

let signatures: string[] = [];

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
