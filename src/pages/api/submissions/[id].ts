import type { APIRoute } from "astro";
import { getSubmissionByToken, resubmit } from "../../../lib/db";
import { sameOrigin } from "../../../lib/auth";

export const prerender = false;

function bad(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, params, url }) => {
  if (!sameOrigin(request, url)) return bad("Bad origin.", 403);

  const id = Number(params.id);
  if (!Number.isInteger(id)) return bad("Bad request.");

  const form = await request.formData();
  const str = (k: string) => String(form.get(k) ?? "").trim();

  if (str("website")) return bad("Rejected.", 400); // honeypot

  const row = await getSubmissionByToken(id, str("token"));
  if (!row) return bad("That link is not valid any more.", 403);
  if (row.status === "approved")
    return bad("This page is already published.", 409);

  const title = str("title");
  const body = str("body");
  if (title.length < 3 || title.length > 120)
    return bad("Title must be 3-120 characters.");
  if (body.length < 50) return bad("The page needs at least 50 characters.");
  if (body.length > 50_000) return bad("That page is too long.");

  const split = (k: string) =>
    str(k)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);

  await resubmit(id, {
    title,
    description: str("description"),
    body,
    categories: split("categories"),
    tags: split("tags"),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      redirect: `/contribute/${id}?token=${encodeURIComponent(str("token"))}&sent=1`,
    }),
    { headers: { "content-type": "application/json" } },
  );
};
