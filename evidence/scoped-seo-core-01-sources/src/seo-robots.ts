import robotsParser from "robots-parser";
import { seoURL, seoUserAgent } from "./seo-model.js";
import { SeoFetchFailure } from "./seo-http.js";

// RFC 9309: percent-encoded unreserved octets compare like their decoded spelling.
export function robotsEncoding(value: string) {
  return value.replace(/%([0-9a-f]{2})/gi, (token, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return /^[A-Za-z0-9._~-]$/.test(char) ? char : token.toUpperCase();
  });
}
export function parseSeoRobots(origin: string, source: string) {
  const url = new URL("/robots.txt", seoURL(origin));
  let rules = 0,
    length = 0,
    wildcards = 0;
  const normalized = source
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .map((line) => {
      const match = /^(\s*(?:allow|disallow)\s*:\s*)(.*)$/i.exec(line);
      if (match) {
        rules++;
        length += match[2].length;
        wildcards += (match[2].match(/\*/g) ?? []).length;
        // An unsupported policy blocks the crawl; never discard rules and accidentally allow access.
        if (
          rules > 4096 ||
          length > 128_000 ||
          match[2].length > 4096 ||
          wildcards > 256
        )
          throw new SeoFetchFailure("SEO_ROBOTS_COMPLEXITY");
      }
      return match ? match[1] + robotsEncoding(match[2]) : line;
    })
    .join("\n");
  const parser = robotsParser(url.href, normalized),
    rawDelay = parser.getCrawlDelay(seoUserAgent);
  const delay =
    typeof rawDelay === "number" && Number.isFinite(rawDelay) && rawDelay >= 0
      ? rawDelay * 1000
      : null;
  return {
    crawl_delay_ms: delay,
    decide(value: string) {
      const target = seoURL(value);
      if (target.origin !== url.origin)
        throw new Error("Robots policy applies only to the original origin");
      // Normalization affects matching only. Requests and saved evidence keep their original URL.
      const comparison = robotsEncoding(target.href);
      const line = parser.getMatchingLineNumber(comparison, seoUserAgent);
      return {
        allowed: parser.isAllowed(comparison, seoUserAgent) === true,
        line: typeof line === "number" && line > 0 ? line : null,
        crawl_delay_ms: delay,
      };
    },
  };
}
