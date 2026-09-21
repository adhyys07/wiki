import pg from "pg";
import crypto from "node:crypto";
import { ENV } from "./env";

const { Pool } = pg;

export type Status = "pending" | "approved" | "rejected" | "changes_requested";

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
  /** Feedback the AUTHOR sees. Distinct from admin_note, which stays internal. */
  review_note: string;
  /** Secret that lets an author return to their submission without an account. */
  edit_token: string | null;
  revision: number;
  paste_ratio: number;
  ai_score: number | null;
  ai_signals: unknown | null;
  starred: boolean;
  starred_at: Date | null;
  starred_by: string | null;
}

export interface SubmissionEvent {
  id: number;
  submission_id: number;
  actor: string;
  action: string;
  note: string;
  created_at: Date;
}

export interface Submission {
  review_note: string;
  /** Secret that lets an author return to their submission without an account. */
  edit_token: string | null;
  revision: number;
}

export interface SubmissionEvent {
  id: number;
  submission_id: number;
  actor: string;
  action: string;
  note: string;
  created_at: Date;
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

    // --- migrations (idempotent) ---
    await getPool().query(`
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '';
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS edit_token  text;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS revision    integer NOT NULL DEFAULT 1;

      -- Guarded: a bare DROP/ADD would take an ACCESS EXCLUSIVE lock and
      -- revalidate the whole table on every process start.
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'submissions'::regclass
             AND conname  = 'submissions_status_check'
             AND pg_get_constraintdef(oid) LIKE '%changes_requested%'
        ) THEN
          ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
          ALTER TABLE submissions ADD CONSTRAINT submissions_status_check
            CHECK (status IN ('pending','approved','rejected','changes_requested'));
        END IF;
      END $$;

      UPDATE submissions
         SET edit_token = md5(random()::text || clock_timestamp()::text || id::text)
       WHERE edit_token IS NULL;

      CREATE TABLE IF NOT EXISTS submission_events (
        id            bigserial PRIMARY KEY,
        submission_id bigint NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        actor         text NOT NULL,
        action        text NOT NULL,
        note          text NOT NULL DEFAULT '',
        created_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS submission_events_sub
        ON submission_events (submission_id, created_at);

      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS paste_ratio real NOT NULL DEFAULT 0;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_score    integer;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_signals  jsonb;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS starred    boolean NOT NULL DEFAULT false;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS starred_at timestamptz;
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS starred_by text;

      CREATE INDEX IF NOT EXISTS submissions_starred
        ON submissions (starred, starred_at DESC) WHERE starred;

      CREATE TABLE IF NOT EXISTS images (
        id            text PRIMARY KEY,
        mime          text NOT NULL,
        bytes         bytea NOT NULL,
        byte_size     integer NOT NULL,
        width         integer,
        height        integer,
        submission_id bigint REFERENCES submissions(id) ON DELETE SET NULL,
        uploaded_by   text NOT NULL DEFAULT 'anonymous',
        created_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS images_submission ON images (submission_id);
    `);
  })();
  return schemaReady;
}

export function newEditToken(): string {
  return crypto.randomBytes(24).toString("base64url");
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
): Promise<{ id: number; token: string }> {
  await ensureSchema();
  const token = newEditToken();
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO submissions
       (title, slug, description, categories, tags, body,
        author_name, author_contact, edit_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
      token,
    ],
  );
  await logEvent(rows[0].id, s.author_name || "anonymous", "submitted");
  return { id: rows[0].id, token };
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
  const out: Record<Status, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    changes_requested: 0,
  };
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

export async function logEvent(
  submissionId: number,
  actor: string,
  action: string,
  note = "",
): Promise<void> {
  await getPool().query(
    `INSERT INTO submission_events (submission_id, actor, action, note)
     VALUES ($1,$2,$3,$4)`,
    [submissionId, actor, action, note],
  );
}

export async function listEvents(
  submissionId: number,
): Promise<SubmissionEvent[]> {
  await ensureSchema();
  const { rows } = await getPool().query<SubmissionEvent>(
    `SELECT * FROM submission_events
      WHERE submission_id = $1
      ORDER BY created_at ASC`,
    [submissionId],
  );
  return rows;
}

/** Token lookup is constant-time so the endpoint can't be used as an oracle. */
export async function getSubmissionByToken(
  id: number,
  token: string,
): Promise<Submission | null> {
  if (!token || !Number.isInteger(id) || id <= 0) return null;
  const row = await getSubmission(id);
  if (!row?.edit_token) return null;
  const a = Buffer.from(row.edit_token);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return row;
}

export async function requestChanges(
  id: number,
  reviewedBy: string,
  reviewNote: string,
  adminNote = "",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSchema();
  if (!reviewNote.trim()) {
    return { ok: false, error: "Tell the author what needs changing." };
  }
  const { rowCount } = await getPool().query(
    `UPDATE submissions SET
       status      = 'changes_requested',
       review_note = $2,
       admin_note  = COALESCE(NULLIF($3,''), admin_note),
       reviewed_by = $4,
       reviewed_at = now()
     WHERE id = $1`,
    [id, reviewNote, adminNote, reviewedBy],
  );
  if (!rowCount) return { ok: false, error: "Submission not found." };
  await logEvent(id, reviewedBy, "changes_requested", reviewNote);
  return { ok: true };
}

/** Author revises and sends it back to the queue. */
export async function resubmit(
  id: number,
  fields: {
    title: string;
    description: string;
    body: string;
    categories: string[];
    tags: string[];
  },
): Promise<void> {
  await getPool().query(
    `UPDATE submissions SET
       title = $2, description = $3, body = $4,
       categories = $5, tags = $6,
       status = 'pending',
       revision = revision + 1,
       review_note = ''
     WHERE id = $1`,
    [
      id,
      fields.title,
      fields.description,
      fields.body,
      fields.categories,
      fields.tags,
    ],
  );
  await logEvent(id, "author", "resubmitted");
}

/** Admin writes a page and publishes it straight away - no queue. */
export async function createAdminPost(
  s: Pick<
    Submission,
    "title" | "slug" | "description" | "categories" | "tags" | "body"
  >,
  author: string,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  await ensureSchema();
  try {
    const { rows } = await getPool().query<{ id: number }>(
      `INSERT INTO submissions
         (title, slug, description, categories, tags, body,
          author_name, status, reviewed_by, reviewed_at, edit_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$7,now(),$8)
       RETURNING id`,
      [
        s.title,
        s.slug,
        s.description,
        s.categories,
        s.tags,
        s.body,
        author,
        newEditToken(),
      ],
    );
    await logEvent(rows[0].id, author, "posted_directly");
    return { ok: true, id: rows[0].id };
  } catch (err: any) {
    if (err?.code === "23505") {
      return { ok: false, error: "An approved page already uses that URL." };
    }
    throw err;
  }
}

/* ---------------------------------------------------------------- images */

export interface StoredImage {
  id: string;
  mime: string;
  bytes: Buffer;
  byte_size: number;
  width: number | null;
  height: number | null;
}

export function newImageId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export async function saveImage(img: {
  mime: string;
  bytes: Buffer;
  width: number | null;
  height: number | null;
  submissionId: number | null;
  uploadedBy: string;
}): Promise<string> {
  await ensureSchema();
  const id = newImageId();
  await getPool().query(
    `INSERT INTO images (id, mime, bytes, byte_size, width, height, submission_id, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      img.mime,
      img.bytes,
      img.bytes.length,
      img.width,
      img.height,
      img.submissionId,
      img.uploadedBy,
    ],
  );
  return id;
}

export async function getImage(id: string): Promise<StoredImage | null> {
  await ensureSchema();
  const { rows } = await getPool().query<StoredImage>(
    `SELECT id, mime, bytes, byte_size, width, height FROM images WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/* ----------------------------------------------------- duplicate matching */

/** Title + description of every approved page, for similarity comparison. */
export async function listApprovedForMatching(): Promise<
  { slug: string; title: string; description: string }[]
> {
  await ensureSchema();
  const { rows } = await getPool().query<{
    slug: string;
    title: string;
    description: string;
  }>(
    `SELECT slug, title, description FROM submissions WHERE status = 'approved'`,
  );
  return rows;
}

/* ------------------------------------------------------------- ai signals */

export async function saveAssessment(
  id: number,
  pasteRatio: number,
  score: number,
  signals: unknown,
): Promise<void> {
  await getPool().query(
    `UPDATE submissions SET paste_ratio = $2, ai_score = $3, ai_signals = $4 WHERE id = $1`,
    [id, pasteRatio, score, JSON.stringify(signals)],
  );
}

/* ------------------------------------------------------------ starring */

/** Editors mark standout pages. Returns the new state. */
export async function toggleStar(
  id: number,
  by: string,
): Promise<{ ok: true; starred: boolean } | { ok: false; error: string }> {
  await ensureSchema();
  const { rows } = await getPool().query<{ starred: boolean }>(
    `UPDATE submissions
        SET starred    = NOT starred,
            starred_at = CASE WHEN NOT starred THEN now() ELSE NULL END,
            starred_by = CASE WHEN NOT starred THEN $2   ELSE NULL END
      WHERE id = $1
      RETURNING starred`,
    [id, by],
  );
  if (!rows.length) return { ok: false, error: "Submission not found." };
  await logEvent(id, by, rows[0].starred ? "starred" : "unstarred");
  return { ok: true, starred: rows[0].starred };
}

export async function listStarred(): Promise<Submission[]> {
  await ensureSchema();
  const { rows } = await getPool().query<Submission>(
    `SELECT * FROM submissions
      WHERE starred AND status = 'approved'
      ORDER BY starred_at DESC`,
  );
  return rows;
}
