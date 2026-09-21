import type { APIRoute } from "astro";
import { getSubmissionByToken, saveImage } from "../../lib/db";
import { probeImage, MAX_BYTES } from "../../lib/images";
import { sameOrigin, SESSION_COOKIE, verifySession } from "../../lib/auth";

export const prerender = false;

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 20;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

function bad(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({
  request,
  url,
  cookies,
  clientAddress,
}) => {
  if (!sameOrigin(request, url)) return bad("Bad origin.", 403);
  if (rateLimited(clientAddress)) return bad("Too many uploads.", 429);

  const form = await request.formData();

  // Uploads must belong to somebody. An open endpoint here would be a free
  // file host for spam and malware distribution on our own domain.
  const admin = verifySession(cookies.get(SESSION_COOKIE)?.value);
  let submissionId: number | null = null;
  let uploadedBy = admin ?? "";

  if (!admin) {
    const id = Number(form.get("submission_id"));
    const token = String(form.get("token") ?? "");
    // Number(null) is 0, which IS an integer - require a real id and token
    // before touching the database, so a bare POST is a clean 403.
    const row =
      Number.isInteger(id) && id > 0 && token
        ? await getSubmissionByToken(id, token)
        : null;
    if (!row) return bad("Not allowed to upload here.", 403);
    submissionId = row.id;
    uploadedBy = row.author_name || "anonymous";
  }

  const file = form.get("file");
  if (!(file instanceof File)) return bad("No file received.");
  if (file.size > MAX_BYTES) return bad("That image is too large.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const probe = probeImage(bytes);
  if (!probe.ok) return bad(probe.error);

  const id = await saveImage({
    mime: probe.result.mime,
    bytes,
    width: probe.result.width,
    height: probe.result.height,
    submissionId,
    uploadedBy,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      id,
      url: `/images/${id}`,
      width: probe.result.width,
      height: probe.result.height,
    }),
    { headers: { "content-type": "application/json" } },
  );
};
