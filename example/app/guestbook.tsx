"use client";

import { useFormStatus } from "flypath";
import { useActionState } from "react";

import { sign } from "./actions.ts";
import { colors } from "./vars.css.ts";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      style={{
        backgroundColor: pending ? colors.secondary : colors.primary,
        borderRadius: 8,
        color: "white",
        padding: 12,
      }}
      type="submit"
    >
      {pending ? "signing…" : "sign"}
    </button>
  );
}

export default function Guestbook() {
  const [error, action, pending] = useActionState(sign, null);

  return (
    <form
      action={action}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <input
        name="name"
        placeholder="your name (client)"
        style={{
          borderColor: colors.primary,
          borderRadius: 6,
          borderStyle: "solid",
          borderWidth: 1,
          padding: 8,
        }}
      />
      <SubmitButton />
      {error && <p style={{ color: "#b00020" }}>{error}</p>}
      {pending && <p style={{ color: colors.secondary }}>pending…</p>}
    </form>
  );
}
