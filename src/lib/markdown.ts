import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Matches the remark-wiki-link resolver in astro.config.mjs. */
function expandWikiLinks(md: string): string {
  return md.replace(WIKILINK, (_m, target: string, label?: string) => {
    const slug = target.trim().toLowerCase().replace(/\s+/g, "-");
    return `[${(label ?? target).trim()}](/wiki/${slug})`;
  });
}

function sanitize(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "blockquote",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "del",
      "code",
      "pre",
      "hr",
      "br",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      // target/rel must be listed here: transformTags runs BEFORE attribute
      // filtering, so anything it adds is dropped unless it is allowed too.
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title"],
      td: ["align"],
      th: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? "";
        const external = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: external
            ? {
                ...attribs,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              }
            : attribs,
        };
      },
    },
  });
}

/**
 * Heading ids are injected AFTER sanitising and are slugified, so a
 * submitter can never inject an attribute through a heading.
 */
export function renderArticle(md: string): {
  html: string;
  headings: Heading[];
} {
  const headings: Heading[] = [];
  const raw = marked.parse(expandWikiLinks(md), {
    async: false,
    gfm: true,
  }) as string;

  const html = sanitize(raw).replace(
    /<h([2-4])>([\s\S]*?)<\/h\1>/g,
    (_m, depth: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const slug = slugify(text) || `section-${headings.length + 1}`;
      headings.push({ depth: Number(depth), slug, text });
      return `<h${depth} id="${slug}">${inner}</h${depth}>`;
    },
  );

  return { html, headings };
}
