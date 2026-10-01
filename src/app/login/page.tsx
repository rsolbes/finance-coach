"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="mx-auto mt-24 flex max-w-xs flex-col gap-3">
      <h1 className="text-xl font-semibold">Finance Coach</h1>
      <input name="passcode" type="password" autoFocus placeholder="Passcode" className="field" required />
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <button className="btn" disabled={pending}>
        Open
      </button>
    </form>
  );
}
