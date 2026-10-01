import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, isValidSession } from "./lib/auth";

export async function proxy(request: NextRequest) {
  if (await isValidSession(request.cookies.get(AUTH_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except the login page, Next internals and the PWA/icon files.
  matcher: ["/((?!login|_next/|favicon.ico|icon|apple-icon|manifest.webmanifest).*)"],
};
