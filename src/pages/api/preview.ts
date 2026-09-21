import type { APIRoute } from "astro";
import { renderArticle } from "../../lib/markdown";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { body } = await request.json().catch(() => ({ body: "" }));
  const { html, headings } = renderArticle(String(body ?? "").slice(0, 60_000));
  return new Response(JSON.stringify({ html, headings }), {
    headers: { "content-type": "application/json" },
  });
};
