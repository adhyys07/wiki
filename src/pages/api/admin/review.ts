import type { APIRoute } from "astro";
import { reviewSubmission } from "../../../lib/db";
import { slugify } from "../../../lib/markdown";
import { sameOrigin } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, url, redirect, locals }) => {
  if (!sameOrigin(request, url))
    return new Response("Bad origin", { status: 403 });

  const form = await request.formData();
  const id = Number(form.get("id"));
  const action = String(form.get("action"));

  if (!Number.isInteger(id) || !["approve", "reject"].includes(action)) {
    return new Response("Bad request", { status: 400 });
  }

  const result = await reviewSubmission(
    id,
    action === "approve" ? "approved" : "rejected",
    locals.adminUser ?? "admin",
    {
      adminNote: String(form.get("admin_note") ?? ""),
      title: String(form.get("title") ?? "") || undefined,
      slug: slugify(String(form.get("slug") ?? "")) || undefined,
      body: String(form.get("body") ?? "") || undefined,
    },
  );

  return result.ok
    ? redirect("/admin?done=" + action, 302)
    : redirect(`/admin/${id}?error=${encodeURIComponent(result.error)}`, 302);
};
