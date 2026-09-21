import type { APIRoute } from "astro";
import { toggleStar } from "../../../lib/db";
import { sameOrigin } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, url, redirect, locals }) => {
  if (!sameOrigin(request, url))
    return new Response("Bad origin", { status: 403 });

  const form = await request.formData();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0)
    return new Response("Bad request", { status: 400 });

  const result = await toggleStar(id, locals.adminUser ?? "admin");
  if (!result.ok) {
    return redirect(`/admin?error=${encodeURIComponent(result.error)}`, 302);
  }

  // Return the editor to wherever they clicked from.
  const back = String(form.get("back") ?? `/admin/${id}`);
  return redirect(back.startsWith("/admin") ? back : `/admin/${id}`, 302);
};
