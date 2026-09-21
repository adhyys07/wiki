import pg from "pg";
import { ENV } from "./env";

const { Pool } = pg;

export type Status = "pending" | "approved" | "rejected";

export interface Submission {
  id: number;
  title: string;
  slug: string;
  description: string;
  categories: string[];
  tags: string[];
  body: string;
  author_name: string;
  author_contact: string;
  status: Status;
  admin_note: string;
  created_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}

let pool: pg.Pool | undefined;
let schemaReady: Promise<void> | undefined;

function ssl() {
  // Heroku Postgres serves a self-signed cert and needs "no-verify".
  // A VPS with a real cert should leave DATABASE_SSL unset so we verify.
  switch (ENV.DATABASE_SSL) {
    case "no-verify":
      return { rejectUnauthorized: false };
    case "off":
      return false;
    default:
      return { rejectUnauthorized: true };
  }
}

export function getPool() {
  if (!pool) {
    const connectionString = ENV.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, ssl: ssl(), max: 10 });
  }
  return pool;
}

/** Idempotent - safe to call on every request; the promise is memoised. */
export function ensureSchema() {
  schemaReady ??= (async () => {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id             bigserial PRIMARY KEY,
        title          text NOT NULL,
        slug           text NOT NULL,
        description    text NOT NULL DEFAULT '',
        categories     text[] NOT NULL DEFAULT '{}',
        tags           text[] NOT NULL DEFAULT '{}',
        body           text NOT NULL,
        author_name    text NOT NULL DEFAULT '',
        author_contact text NOT NULL DEFAULT '',
        status         text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
        admin_note     text NOT NULL DEFAULT '',
        created_at     timestamptz NOT NULL DEFAULT now(),
        reviewed_at    timestamptz,
        reviewed_by    text
      );

      CREATE UNIQUE INDEX IF NOT EXISTS submissions_approved_slug
        ON submissions (slug) WHERE status = 'approved';

      CREATE INDEX IF NOT EXISTS submissions_status_created
        ON submissions (status, created_at DESC);
    `);
  })();
  return schemaReady;
}

export async function createSubmission(
  s: Pick<
    Submission,
    | "title"
    | "slug"
    | "description"
    | "categories"
    | "tags"
    | "body"
    | "author_name"
    | "author_contact"
  >,
): Promise<number> {
  await ensureSchema();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO submissions
       (title, slug, description, categories, tags, body, author_name, author_contact)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      s.title,
      s.slug,
      s.description,
      s.categories,
      s.tags,
      s.body,
      s.author_name,
      s.author_contact,
    ],
  );
  return rows[0].id;
}

export async function listSubmissions(status?: Status): Promise<Submission[]> {
  await ensureSchema();
  const { rows } = await getPool().query<Submission>(
    status
      ? `SELECT * FROM submissions WHERE status = $1 ORDER BY created_at DESC`
      : `SELECT * FROM submissions ORDER BY created_at DESC`,
    status ? [status] : [],
  );
  return rows;
}

export async function countByStatus(): Promise<Record<Status, number>> {
  await ensureSchema();
  const { rows } = await getPool().query<{ status: Status; n: string }>(
    `SELECT status, count(*) AS n FROM submissions GROUP BY status`,
  );
  const out: Record<Status, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export async function getSubmission(id: number): Promise<Submission | null> {
  await ensureSchema();
  const { rows } = await getPool().query<Submission>(
    `SELECT * FROM submissions WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getApprovedBySlug(
  slug: string,
): Promise<Submission | null> {
  await ensureSchema();
  const { rows } = await getPool().query<Submission>(
    `SELECT * FROM submissions WHERE slug = $1 AND status = 'approved'`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function listApproved(): Promise<Submission[]> {
  await ensureSchema();
  const { rows } = await getPool().query<Submission>(
    `SELECT * FROM submissions WHERE status = 'approved' ORDER BY reviewed_at DESC`,
  );
  return rows;
}

/** Admins may correct the text while approving, so edits are part of the review. */
export async function reviewSubmission(
  id: number,
  status: Exclude<Status, "pending">,
  reviewedBy: string,
  opts: {
    adminNote?: string;
    title?: string;
    slug?: string;
    body?: string;
  } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  try {
    const { rowCount } = await getPool().query(
      `UPDATE submissions SET
         status      = $2,
         reviewed_by = $3,
         reviewed_at = now(),
         admin_note  = COALESCE($4, admin_note),
         title       = COALESCE($5, title),
         slug        = COALESCE($6, slug),
         body        = COALESCE($7, body)
       WHERE id = $1`,
      [
        id,
        status,
        reviewedBy,
        opts.adminNote ?? null,
        opts.title ?? null,
        opts.slug ?? null,
        opts.body ?? null,
      ],
    );
    if (!rowCount) return { ok: false, error: "Submission not found." };
    return { ok: true };
  } catch (err: any) {
    if (err?.code === "23505") {
      return {
        ok: false,
        error: "Another approved page already uses that URL. Change the slug.",
      };
    }
    throw err;
  }
}
