import { parse, type DefaultTreeAdapterTypes as HTML } from "parse5";
import { hash } from "./lib.js";
import { SeoFetchFailure, type SeoResponse } from "./seo-http.js";
import {
  seoLimits,
  seoURL,
  type SeoIssue,
  type SeoLocation,
  type SeoPage,
} from "./seo-model.js";

/** Keep original byte and decoded source hashes separate: parser offsets address UTF-16 text. */
export function decodeSeoHTML(response: Pick<SeoResponse, "headers" | "body">) {
  const mime = response.headers["content-type"] ?? "";
  if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(mime))
    throw new SeoFetchFailure("SEO_CONTENT_TYPE_UNSUPPORTED");
  const bytes = response.body;
  let charset = /^\s*(?:[^;]+);.*?charset\s*=\s*["']?([^\s;"']+)/i.exec(
    mime,
  )?.[1];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    charset = "utf-8";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) charset = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) charset = "utf-16be";
  if (!charset) {
    const head = parse(bytes.subarray(0, 1024).toString("latin1"));
    const pending: HTML.Node[] = [head];
    while (pending.length && !charset) {
      const node = pending.shift()!;
      if ("tagName" in node && node.tagName === "meta") {
        const attr = Object.fromEntries(
          node.attrs.map((a) => [a.name, a.value]),
        );
        charset =
          attr.charset ||
          ((attr["http-equiv"] ?? "").toLowerCase() === "content-type"
            ? /charset\s*=\s*["']?([^\s;"']+)/i.exec(attr.content ?? "")?.[1]
            : undefined);
      }
      if ("childNodes" in node) pending.push(...node.childNodes);
    }
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || "utf-8", { fatal: true });
  } catch {
    throw new SeoFetchFailure("SEO_CHARSET_UNSUPPORTED");
  }
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new SeoFetchFailure("SEO_CHARSET_INVALID");
  }
  return {
    text,
    charset: decoder.encoding,
    source_sha256: hash(Buffer.from(text, "utf8")),
    raw_sha256: hash(bytes),
  };
}

const normalizedText = (value: string) => value.replace(/\s+/gu, " ").trim();
const attrs = (node: HTML.Element) =>
  Object.fromEntries(node.attrs.map((a) => [a.name, a.value]));
function textContent(node: HTML.Node) {
  const pieces: string[] = [],
    pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if ("value" in current) pieces.push(current.value);
    else if ("childNodes" in current)
      pending.push(...[...current.childNodes].reverse());
  }
  return pieces.join("");
}

export function parseSeoPage(
  url: string,
  source: string,
  headers: Record<string, string> = {},
): SeoPage {
  const original = seoURL(url),
    document = parse(source, { sourceCodeLocationInfo: true });
  const elements: HTML.Element[] = [],
    pending: HTML.Node[] = [document];
  while (pending.length) {
    const node = pending.pop()!;
    if ("tagName" in node) elements.push(node);
    // Template contents are inert and cannot supply a page title, canonical or crawl link.
    if ("childNodes" in node) pending.push(...[...node.childNodes].reverse());
  }
  const location = (
    node?: HTML.Element,
    attribute?: string,
  ): SeoLocation | null => {
    const offset = attribute
      ? node?.sourceCodeLocation?.attrs?.[attribute]
      : node?.sourceCodeLocation;
    if (!offset) return null;
    const start = offset.startOffset,
      end = Math.min(offset.endOffset, start + 400);
    return {
      start,
      end,
      unit: "utf16_code_units",
      quote: source.slice(start, end),
    };
  };
  const issues: SeoIssue[] = [];
  const issue = (
    code: string,
    detail: string,
    node?: HTML.Element,
    severity: SeoIssue["severity"] = "warning",
    target?: string,
  ) => {
    issues.push({
      code,
      severity,
      url: original.href,
      location: location(node),
      detail,
      ...(target ? { target_url: target } : {}),
    });
  };
  let base = original;
  const firstBase = elements.find(
    (e) => e.tagName === "base" && "href" in attrs(e),
  );
  if (firstBase) {
    try {
      base = seoURL(new URL(attrs(firstBase).href, original).href);
    } catch {
      issue(
        "base_invalid",
        "The first base URL is invalid; inspect relative URL resolution.",
        firstBase,
      );
    }
  }
  const titles = elements.filter((e) => e.tagName === "title");
  const pageTitle = titles.length ? normalizedText(textContent(titles[0])) : "";
  if (!pageTitle)
    issue("title_missing", "Add a descriptive page title.", titles[0]);
  if (titles.length > 1)
    issue("title_multiple", "Keep one title element per page.", titles[1]);
  if (pageTitle && ([...pageTitle].length < 15 || [...pageTitle].length > 80))
    issue(
      "title_length_review",
      "Review title clarity and length; this heuristic does not predict search ranking.",
      titles[0],
      "info",
    );
  const descriptions = elements.filter(
    (e) =>
      e.tagName === "meta" &&
      (attrs(e).name ?? "").toLowerCase() === "description",
  );
  if (
    !descriptions.length ||
    !normalizedText(attrs(descriptions[0]).content ?? "")
  )
    issue(
      "description_missing",
      "Add a page-specific description.",
      descriptions[0],
    );
  if (descriptions.length > 1)
    issue(
      "description_multiple",
      "Keep one meta description.",
      descriptions[1],
    );
  const headings = elements.filter((e) => e.tagName === "h1");
  if (!headings.length)
    issue("h1_missing", "Review whether the main content needs an H1.");
  if (headings.length > 1)
    issue(
      "h1_multiple",
      "Review heading hierarchy; multiple H1 elements are not an automatic ranking failure.",
      headings[1],
      "info",
    );
  const canonical = elements.filter(
    (e) =>
      e.tagName === "link" &&
      (attrs(e).rel ?? "").toLowerCase().split(/\s+/).includes("canonical"),
  );
  if (!canonical.length)
    issue(
      "canonical_missing",
      "Review whether a canonical URL is needed.",
      undefined,
      "info",
    );
  if (canonical.length > 1)
    issue(
      "canonical_multiple",
      "Use a single intended canonical URL.",
      canonical[1],
    );
  const canonicalURLs: string[] = [];
  for (const element of canonical) {
    try {
      if (!attrs(element).href) throw new Error("missing");
      const target = seoURL(new URL(attrs(element).href, base).href);
      canonicalURLs.push(target.href);
      if (target.hostname !== original.hostname)
        issue(
          "canonical_cross_host",
          "Confirm that the canonical intentionally names another host; it was not fetched.",
          element,
          "info",
          target.href,
        );
    } catch {
      issue(
        "canonical_invalid",
        "Set a valid HTTP or HTTPS canonical URL.",
        element,
      );
    }
  }
  const robots: string[] = [],
    directives: string[] = [];
  for (const element of elements.filter((e) => e.tagName === "meta")) {
    const a = attrs(element),
      agent = (a.name ?? "").toLowerCase();
    if (["robots", "copypastebot", "googlebot", "bingbot"].includes(agent)) {
      robots.push(agent + ": " + (a.content ?? ""));
      if (agent === "robots" || agent === "copypastebot")
        directives.push(a.content ?? "");
    }
  }
  const header = headers["x-robots-tag"];
  if (header) {
    robots.push("x-robots-tag: " + header);
    // A named crawler header does not silently control CopyPasteBot's link traversal.
    let applies = true;
    for (const part of header.toLowerCase().split(",")) {
      const scoped = /^\s*([a-z][a-z0-9_-]*):\s*(.*)$/.exec(part);
      if (
        scoped &&
        ![
          "max-snippet",
          "max-image-preview",
          "max-video-preview",
          "unavailable_after",
        ].includes(scoped[1])
      ) {
        applies = scoped[1] === "copypastebot";
        if (applies) directives.push(scoped[2]);
      } else if (applies) directives.push(part);
    }
  }
  const tokens = directives
    .join(",")
    .toLowerCase()
    .split(/[\s,]+/);
  if (tokens.includes("noindex") || tokens.includes("none"))
    issue(
      "indexing_disabled",
      "Indexing is explicitly disabled for this page; confirm that this is intended.",
      undefined,
      "info",
    );
  const jsonLD: SeoPage["json_ld"] = [];
  for (const element of elements.filter(
    (e) =>
      e.tagName === "script" &&
      (attrs(e).type ?? "").split(";")[0].trim().toLowerCase() ===
        "application/ld+json",
  )) {
    let valid = true;
    try {
      JSON.parse(textContent(element));
    } catch {
      valid = false;
      issue(
        "json_ld_invalid",
        "Correct invalid JSON-LD syntax. Schema and rich-result eligibility require a separate validator.",
        element,
      );
    }
    const loc = location(element);
    if (loc) jsonLD.push({ valid, location: loc });
  }
  const links: SeoPage["links"] = [],
    limitations = [
      "Server HTML only; scripts, forms, authenticated content and rich-result eligibility were not executed or validated.",
    ];
  for (const element of elements.filter(
    (e) => e.tagName === "a" || e.tagName === "area",
  )) {
    const a = attrs(element),
      loc = location(element, "href");
    if (!a.href || !loc || a.href.trim().startsWith("#")) continue;
    try {
      const target = seoURL(new URL(a.href, base).href);
      if (links.length >= seoLimits.linksPerPage) {
        limitations.push("Link discovery stopped at the per-page limit.");
        break;
      }
      links.push({
        url: target.href,
        nofollow: (a.rel ?? "").toLowerCase().split(/\s+/).includes("nofollow"),
        location: loc,
      });
    } catch {
      /* Unsupported protocols and ambiguous paths are not crawl targets. */
    }
  }
  const loginPage = elements.some(
    (e) =>
      e.tagName === "input" &&
      (attrs(e).type ?? "").toLowerCase() === "password",
  );
  if (loginPage)
    issue(
      "login_form",
      "A password form was observed. No credentials or forms were submitted.",
      elements.find(
        (e) =>
          e.tagName === "input" &&
          (attrs(e).type ?? "").toLowerCase() === "password",
      ),
      "info",
    );
  return {
    url: original.href,
    title: pageTitle,
    descriptions: descriptions.map((e) =>
      normalizedText(attrs(e).content ?? ""),
    ),
    headings: headings.map((e) => normalizedText(textContent(e))),
    canonical_urls: canonicalURLs,
    robots,
    json_ld: jsonLD,
    links,
    issues,
    login_page: loginPage,
    nofollow: tokens.includes("nofollow") || tokens.includes("none"),
    content_language:
      attrs(elements.find((e) => e.tagName === "html")!).lang ||
      headers["content-language"] ||
      null,
    source_sha256: hash(Buffer.from(source, "utf8")),
    limitations,
  };
}
