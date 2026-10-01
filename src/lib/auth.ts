// Single-user passcode. If APP_PASSCODE is unset the app is open (fine on your own PC);
// set it before opening the app to your phone or the internet.
export const AUTH_COOKIE = "fc_session";

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSCODE);
}

/** Cookie value derived from the passcode, so changing the passcode logs every device out. */
export async function sessionToken(): Promise<string> {
  const data = new TextEncoder().encode(`finance-coach:${process.env.APP_PASSCODE ?? ""}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  const expected = await sessionToken();
  if (cookieValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= cookieValue.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
