import "server-only";
import { cookies } from "next/headers";
import { AUTH_COOKIE, isValidSession } from "./auth";

/** Call at the top of every Server Action and API route: they're reachable by direct POST. */
export async function requireAuth(): Promise<void> {
  const jar = await cookies();
  if (!(await isValidSession(jar.get(AUTH_COOKIE)?.value))) throw new Error("Unauthorized");
}
