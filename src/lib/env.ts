/**
 * Astro/Vite loads a local .env into `import.meta.env`, never `process.env`.
 * In production (Heroku, systemd, Docker) the real variables live in
 * `process.env`. Check process.env first so a value baked in at build time can
 * never shadow the real one, and only fall back to .env during dev.
 */
const dev = import.meta.env.DEV;

function read(key: string, fromEnvFile: unknown): string | undefined {
  return (
    process.env[key] ?? (dev ? (fromEnvFile as string | undefined) : undefined)
  );
}

export const ENV = {
  get DATABASE_URL() {
    return read("DATABASE_URL", import.meta.env.DATABASE_URL);
  },
  get DATABASE_SSL() {
    return read("DATABASE_SSL", import.meta.env.DATABASE_SSL);
  },
  get ADMIN_PASSWORD() {
    return read("ADMIN_PASSWORD", import.meta.env.ADMIN_PASSWORD);
  },
  get ADMIN_SESSION_SECRET() {
    return read("ADMIN_SESSION_SECRET", import.meta.env.ADMIN_SESSION_SECRET);
  },
};
