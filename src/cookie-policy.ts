import type { Config } from "./config.js";

/** Public TLS may terminate at a proxy while the authorized synthetic API stays private. */
export function secureBrowserCookie(
  config: Pick<Config, "NODE_ENV" | "WEB_ORIGIN" | "ADMIN_ORIGIN" | "API_ORIGIN">,
  origin: "WEB_ORIGIN" | "ADMIN_ORIGIN" | "API_ORIGIN" = "WEB_ORIGIN",
): boolean {
  return config.NODE_ENV === "production" || new URL(config[origin]).protocol === "https:";
}
