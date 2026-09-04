import type { Context } from "flypath";
import { context, cookies, db } from "flypath";

export type User = { id: number; handle: string; name: string };

export const SESSION_COOKIE = "session";

export const session: Context<User> = context<User>();

export const visitor: Context<User | null> = context<User | null>(null);

export const requestId: Context<string> = context<string>();

export async function findUser(handle: string): Promise<User | undefined> {
  return db()
    .from("users")
    .where("handle", "=", handle)
    .select("id", "handle", "name")
    .first();
}

export async function userFromSession(): Promise<User | undefined> {
  const handle = cookies(SESSION_COOKIE);
  return handle === undefined ? undefined : findUser(handle);
}
