// @ts-check
import { defineConfig } from "astro/config";
import { readdirSync, existsSync } from "fs";
import remarkWikiLink from "remark-wiki-link";
import node from "@astrojs/node";

function getWikiPermalinks() {
  const dir = "src/content/wiki";
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  site: "https://wiki.adhyys.hackclub.app",
   security: {
     allowedDomains: [
       { hostname: "wiki.adhyys.hackclub.app", protocol: "https" },
     ],
   },
  vite: {
    define: {
      GITHUB_EDIT_BASE: JSON.stringify(
        "https://github.com/hackclub/wiki/edit/main/src/content/wiki/",
      ),
    },
    build: {
      rollupOptions: {
        external: ["/pagefind/pagefind-ui.js", "/pagefind/pagefind.js"],
      },
    },
  },
  markdown: {
    remarkPlugins: [
      [
        remarkWikiLink,
        {
          permalinks: getWikiPermalinks(),
          pageResolver: (name) => [name.toLowerCase().replace(/\s+/g, "-")],
          hrefTemplate: (p) => `/wiki/${p}`,
          wikiLinkClassName: "wiki-link",
          newClassName: "wiki-link--new",
        },
      ],
    ],
  },
});
