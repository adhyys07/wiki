import type { APIRoute } from "astro";
import { reviewSubmission, requestChanges, logEvent } from "../../../lib/db";
import { slugify } from "../../../lib/markdown";
import { sameOrigin } from "../../../lib/auth";

export const prerender = false;

const ACTIONS = ["approve", "reject", "request_changes"] as const;
type Action = (typeof ACTIONS)[number];

export const POST: APIRoute = async ({ request, url, redirect, locals }) => {
  if (!sameOrigin(request, url))
    return new Response("Bad origin", { status: 403 });

  const form = await request.formData();
  const id = Number(form.get("id"));
  const action = String(form.get("action")) as Action;
  const actor = locals.adminUser ?? "admin";

  if (!Number.isInteger(id) || !ACTIONS.includes(action)) {
    return new Response("Bad request", { status: 400 });
  }

  const adminNote = String(form.get("admin_note") ?? "");
  const reviewNote = String(form.get("review_note") ?? "");

  if (action === "request_changes") {
    const r = await requestChanges(id, actor, reviewNote, adminNote);
    return r.ok
      ? redirect("/admin?done=request_changes", 302)
      : redirect(`/admin/${id}?error=${encodeURIComponent(r.error)}`, 302);
  }

  const r = await reviewSubmission(
    id,
    action === "approve" ? "approved" : "rejected",
    actor,
    {
      adminNote,
      title: String(form.get("title") ?? "") || undefined,
      slug: slugify(String(form.get("slug") ?? "")) || undefined,
      body: String(form.get("body") ?? "") || undefined,
    },
  );

  if (!r.ok) {
    return redirect(`/admin/${id}?error=${encodeURIComponent(r.error)}`, 302);
  }
  await logEvent(
    id,
    actor,
    action === "approve" ? "approved" : "rejected",
    adminNote,
  );
  return redirect(`/admin?done=${action}`, 302);
};
