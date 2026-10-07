"use server";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// Cosmetic preference only: no auth needed, value is allow-listed, cookie is HttpOnly (the server renders the class).
export async function setThemeAction(fd: FormData): Promise<void> {
  const raw = fd.get("theme");
  const theme = parseTheme(typeof raw === "string" ? raw : null);
  (await cookies()).set(THEME_COOKIE, theme, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}
