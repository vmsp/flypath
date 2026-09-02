import type { Context } from "flypath";
import { context, cookies } from "flypath";

export type User = { id: string; name: string };

export const SESSION_COOKIE = "session";

const users: Readonly<Record<string, User>> = {
  ada: { id: "ada", name: "Ada Lovelace" },
  grace: { id: "grace", name: "Grace Hopper" },
};

export const session: Context<User> = context<User>();

export const visitor: Context<User | null> = context<User | null>(null);

export const requestId: Context<string> = context<string>();

export function findUser(id: string): User | undefined {
  return users[id];
}

export function userFromSession(): User | undefined {
  const id = cookies(SESSION_COOKIE);
  return id === undefined ? undefined : findUser(id);
}
