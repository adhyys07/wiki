import type { APIRoute } from "astro";
import { getImage } from "../../lib/db";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const row = await getImage(String(params.id ?? ""));
  if (!row) return new Response(null, { status: 404 });

  return new Response(row.bytes, {
    headers: {
      // Content-Type comes from our own magic-byte probe, never the upload.
      "content-type": row.mime,
      "content-length": String(row.byte_size),
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};
