/**
 * Advisory signals that a submission may be machine-written.
 *
 * READ THIS BEFORE TRUSTING THE NUMBER.
 *
 * There is no reliable way to detect AI-generated text. Every published
 * detector produces false positives, and they land hardest on people writing
 * in a second language — which for this audience means real contributors get
 * accused. So this module deliberately does NOT return a verdict: it returns
 * individual, explainable signals with the evidence attached, for a human to
 * read and overrule. Nothing here should ever auto-reject a submission.
 */

export interface Signal {
  key: string;
  label: string;
  /** 0..1, higher = more consistent with machine writing. */
  score: number;
  weight: number;
  detail: string;
}

export interface Assessment {
  /** 0..100, weighted. A prompt to look closer, not a probability. */
  score: number;
  band: "low" | "medium" | "high";
  signals: Signal[];
}

/** Phrases that appear far more often in LLM prose than in teenage wiki writing. */
const TELLS = [
  "delve into",
  "it's important to note",
  "it is important to note",
  "in today's world",
  "in the world of",
  "navigate the",
  "tapestry",
  "testament to",
  "a wide range of",
  "plays a crucial role",
  "plays a vital role",
  "it's worth noting",
  "in conclusion",
  "furthermore",
  "moreover",
  "additionally, it",
  "seamless",
  "robust",
  "leverage the",
  "foster a",
  "unlock the",
  "elevate your",
  "embark on",
  "realm of",
  "multifaceted",
  "underscore",
  "when it comes to",
  "the key is to",
  "not only ... but also",
];

const HEDGES = [
  "generally",
  "typically",
  "often",
  "usually",
  "in most cases",
  "can vary",
  "may vary",
  "it depends",
  "some people",
  "many people",
];

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, " ") // code blocks aren't prose
    .replace(/[#>*_`\[\]()]/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1),
  );
}

function countMatches(haystack: string, needles: string[]): string[] {
  const found: string[] = [];
  for (const n of needles) if (haystack.includes(n)) found.push(n);
  return found;
}

export function assess(body: string, pasteRatio = 0): Assessment {
  const text = body.toLowerCase();
  const words = body.split(/\s+/).filter(Boolean);
  const sents = sentences(body);
  const signals: Signal[] = [];

  // 1 — how the text arrived. Strong but not conclusive: people draft elsewhere.
  signals.push({
    key: "paste",
    label: "Arrived by paste",
    score: Math.min(1, pasteRatio),
    weight: 2,
    detail:
      pasteRatio > 0.9
        ? "Essentially the whole body was pasted in one go."
        : pasteRatio > 0.5
          ? `About ${Math.round(pasteRatio * 100)}% of the text was pasted.`
          : pasteRatio > 0
            ? `${Math.round(pasteRatio * 100)}% pasted — normal for quoting.`
            : "Typed directly into the form.",
  });

  // 2 — burstiness. Human sentence length varies more than a model's.
  const lens = sents.map((s) => s.split(/\s+/).length);
  const sd = stdev(lens);
  const burst = lens.length < 5 ? 0 : Math.max(0, Math.min(1, (9 - sd) / 9));
  signals.push({
    key: "burstiness",
    label: "Sentence-length variation",
    score: burst,
    weight: 1.5,
    detail:
      lens.length < 5
        ? "Too few sentences to judge."
        : `Std. deviation ${sd.toFixed(1)} words across ${lens.length} sentences` +
          (sd < 5 ? " — unusually even." : " — within a normal human range."),
  });

  // 3 — stock phrasing.
  const tells = countMatches(text, TELLS);
  signals.push({
    key: "lexicon",
    label: "Stock LLM phrasing",
    score: Math.min(1, tells.length / 4),
    weight: 1.5,
    detail: tells.length
      ? `Found: ${tells.slice(0, 5).join(", ")}`
      : "No characteristic phrases found.",
  });

  // 4 — specificity. The best signal for THIS wiki: a model does not know
  // the real channel names, dollar amounts or URLs.
  const numbers = (body.match(/\b\d[\d,.]*\b/g) ?? []).length;
  const links = (body.match(/https?:\/\/|\]\(/g) ?? []).length;
  const handles = (body.match(/[@#][a-z0-9_-]{2,}/gi) ?? []).length;
  const per100 =
    ((numbers + links + handles) / Math.max(1, words.length)) * 100;
  signals.push({
    key: "specificity",
    label: "Concrete detail",
    score: Math.max(0, Math.min(1, (1.6 - per100) / 1.6)),
    weight: 2,
    detail:
      `${numbers} numbers, ${links} links, ${handles} handles/channels across ${words.length} words` +
      (per100 < 0.6 ? " — very little that is checkable." : "."),
  });

  // 5 — hedging.
  const hedges = countMatches(text, HEDGES);
  signals.push({
    key: "hedging",
    label: "Hedged, non-committal wording",
    score: Math.min(1, hedges.length / 5),
    weight: 1,
    detail: hedges.length
      ? `Found: ${hedges.slice(0, 5).join(", ")}`
      : "Writing commits to specifics.",
  });

  // 6 — structural uniformity across sections.
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const psd = stdev(paras.map((p) => p.split(/\s+/).length));
  const uniform =
    paras.length < 4 ? 0 : Math.max(0, Math.min(1, (18 - psd) / 18));
  signals.push({
    key: "uniformity",
    label: "Paragraph uniformity",
    score: uniform,
    weight: 1,
    detail:
      paras.length < 4
        ? "Too few paragraphs to judge."
        : `${paras.length} paragraphs, std. deviation ${psd.toFixed(1)} words` +
          (psd < 10 ? " — suspiciously even." : "."),
  });

  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  const score = Math.round(
    (signals.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight) * 100,
  );

  return {
    score,
    band: score >= 65 ? "high" : score >= 40 ? "medium" : "low",
    signals,
  };
}
