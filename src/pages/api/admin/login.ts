import type { APIRoute } from "astro";
import {
  checkPassword,
  sameOrigin,
  sessionCookieOptions,
  signSession,
  SESSION_COOKIE,
} from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  if (!sameOrigin(request, url))
    return new Response("Bad origin", { status: 403 });

  const form = await request.formData();
  const next = String(form.get("next") ?? "/admin");

  if (!checkPassword(String(form.get("password") ?? ""))) {
    return redirect("/admin/login?error=1", 302);
  }

  cookies.set(SESSION_COOKIE, signSession("admin"), sessionCookieOptions());
  return redirect(next.startsWith("/admin") ? next : "/admin", 302);
};
