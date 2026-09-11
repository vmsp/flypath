"use server";

import { navigate } from "../../../src/router/navigate-server.ts";
import { cookies } from "../../../src/runtime/cookies.ts";

export async function redirectAction() {
  cookies.set("session", "action");
  navigate("/destination");
}

export async function missingAction() {
  navigate("not-found");
}
