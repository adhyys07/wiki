import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE, verifySession } from "./lib/auth";

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  const guarded = path.startsWith("/admin") || path.startsWith("/api/admin");
  const isPublic = path === "/admin/login" || path === "/api/admin/login";

  if (guarded && !isPublic) {
    const user = verifySession(ctx.cookies.get(SESSION_COOKIE)?.value);
    if (!user) {
      return path.startsWith("/api/")
        ? new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
        : ctx.redirect(`/admin/login?next=${encodeURIComponent(path)}`, 302);
    }
    ctx.locals.adminUser = user;
  }

  return next();
});
