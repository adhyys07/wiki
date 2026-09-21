/**
 * Duplicate detection by character-trigram Dice coefficient — the same
 * measure Postgres pg_trgm uses, computed in JS so it needs no extension.
 *
 * The corpus here is small (markdown pages + approved submissions). If it
 * grows past a few thousand rows, move the comparison into Postgres with
 * pg_trgm and a GIN index; the shape of `findSimilar` stays the same.
 */

export interface Candidate {
  slug: string;
  title: string;
  description?: string;
  href: string;
  source: "page" | "community";
}

export interface Match extends Candidate {
  score: number; // 0..1
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function trigrams(input: string): Set<string> {
  const s = `  ${normalise(input)} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Dice coefficient: 2|A∩B| / (|A|+|B|). 1 = identical, 0 = nothing shared. */
export function dice(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** True when one title's words are wholly contained in the other. */
function containment(a: string, b: string): boolean {
  const A = new Set(normalise(a).split(" ").filter(Boolean));
  const B = new Set(normalise(b).split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return false;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

export function findSimilar(
  title: string,
  description: string,
  candidates: Candidate[],
  limit = 5,
): Match[] {
  const threshold = 0.34;

  return candidates
    .map((c) => {
      const titleScore = dice(title, c.title);
      const descScore = description
        ? dice(description, c.description ?? "") * 0.5
        : 0;
      // "Hackathons" vs "Running Hackathons" scores low on Dice but is
      // exactly the duplicate we care most about.
      const boost = containment(title, c.title) ? 0.35 : 0;
      return {
        ...c,
        score: Math.min(1, Math.max(titleScore + boost, descScore)),
      };
    })
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
