import assert from "node:assert/strict";
import type { Page } from "playwright";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";

export async function exerciseBrandLibrary({
  page,
  repo,
  attempt,
  delivery,
  pass,
  screenshots,
  resize,
  captureSurface,
}: {
  page: Page;
  repo: "web" | "desktop";
  attempt: string;
  delivery: string;
  pass: (s: string) => void;
  screenshots: any[];
  resize: (w: number, h: number, label: string) => Promise<any>;
  captureSurface?: () => Promise<Buffer>;
}) {
  const previous = await page.evaluate(() => ({
    url: location.href,
    locale: localStorage.getItem("cp_locale"),
    theme: localStorage.getItem("cp_theme"),
  }));
  const setTheme = async (value: "light" | "dark") => {
    // System mode may currently look light. A single click then chooses explicit
    // light rather than dark, so observe the actual UI while cycling its control.
    for (
      let i = 0;
      i < 4 &&
      (await page.evaluate(() => document.documentElement.dataset.theme)) !== value;
      i++
    ) {
      await page
        .getByTitle("Theme: light / dark / system", { exact: true })
        .click();
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      value,
    );
  };
  const capture = async (name: string) => {
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    screenshots.push(
      await saveWorkmateScreenshot(
        repo,
        "brand-" + attempt,
        name,
        await (captureSurface ?? (() => page.screenshot()))(),
        "Actual brand library, immutable publication and preflight. Customer brand facts are explicit fixtures; font validation and API writes are real.",
        delivery,
      ),
    );
  };
  const recording = new WorkmateRecording(
    repo,
    "brand-library",
    "brand-" + attempt,
    captureSurface ?? (() => page.screenshot({ type: "jpeg", quality: 85 })),
    "Actual brand publication, old-version fact lookup, font coverage and expiry checks with real database and bundled font; fixture brand content",
    delivery,
  );
  let media: any;
  try {
    if (repo === "desktop")
      await page.evaluate(() => {
        location.hash = "/app/brand";
      });
    else await page.goto("http://localhost:4317/app/brand");
    await page
      .getByRole("heading", { name: "Brand library", exact: true })
      .waitFor();
    await recording.start();
    await page.getByRole("button", { name: "Add brand", exact: true }).click();
    let modal = page.getByRole("dialog");
    await modal
      .getByLabel("Brand name", { exact: true })
      .fill("Spring · 固定品牌");
    await modal
      .getByLabel("Tone & style", { exact: true })
      .fill("Confident, clear and Traditional Chinese. Explicit test brand.");
    await modal
      .getByLabel("Approved copy", { exact: true })
      .fill("An approved spring offer.");
    await modal
      .getByRole("button", { name: "Products & offers", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Add product fact", exact: true })
      .click();
    await modal.getByLabel("Fact key", { exact: true }).fill("offer");
    await modal.getByLabel("Type", { exact: true }).selectOption("promotion");
    await modal
      .getByLabel("Approved statement", { exact: true })
      .fill("春日優惠");
    await modal.getByLabel("Price (optional)", { exact: true }).fill("128");
    await modal
      .getByLabel("Valid until", { exact: true })
      .fill("2099-01-01T00:00");
    await capture("editor-facts-en");
    await modal
      .getByRole("button", { name: "Publish brand version", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Spring · 固定品牌", exact: true })
      .waitFor();
    await capture("library-v1-en");
    pass(
      repo +
        " brand library publishes a real fixed version with font rights, approved price and promotion expiry through its visible form",
    );
    const card = page.locator(".brand-library-grid article").filter({
      has: page.getByRole("heading", {
        name: "Spring · 固定品牌",
        exact: true,
      }),
    });
    await card
      .getByRole("button", { name: "Edit & publish version", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("button", { name: "Products & offers", exact: true })
      .click();
    await modal.getByLabel("Price (optional)", { exact: true }).fill("188");
    await modal
      .getByRole("button", { name: "Publish brand version", exact: true })
      .click();
    await modal.waitFor({ state: "detached" });
    await card.getByText("BRAND · v2", { exact: true }).waitFor();
    await card
      .getByRole("button", { name: "Versions & preflight", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal.getByLabel("Brand version", { exact: true }).selectOption("1");
    await modal
      .getByLabel("Referenced fact (optional)", { exact: true })
      .selectOption("offer");
    await modal
      .getByRole("button", { name: "Check fonts & facts", exact: true })
      .click();
    await modal
      .locator(".brand-preflight-result")
      .filter({ hasText: "128" })
      .waitFor();
    await capture("fixed-v1-preflight-en");
    await modal.getByLabel("Brand version", { exact: true }).selectOption("2");
    await modal
      .getByLabel("Referenced fact (optional)", { exact: true })
      .selectOption("offer");
    await modal
      .getByRole("button", { name: "Check fonts & facts", exact: true })
      .click();
    await modal
      .locator(".brand-preflight-result")
      .filter({ hasText: "188" })
      .waitFor();
    pass(
      repo +
        " explicitly selecting old and new brand versions returns their original 128 and 188 prices without silent replacement",
    );
    await modal
      .getByLabel("Referenced fact (optional)", { exact: true })
      .selectOption("");
    await modal
      .getByLabel("Sample text", { exact: true })
      .fill("Missing glyph " + String.fromCodePoint(0x10ffff));
    await modal
      .getByRole("button", { name: "Check fonts & facts", exact: true })
      .click();
    await modal
      .locator(".brand-error-details")
      .filter({ hasText: "U+10FFFF" })
      .waitFor();
    await resize(
      repo === "desktop" ? 800 : 390,
      repo === "desktop" ? 600 : 850,
      "brand compact preflight",
    );
    await modal
      .getByRole("button", { name: "Check fonts & facts", exact: true })
      .focus();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    if (repo === "desktop")
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("*")].some((el) => {
            const style = getComputedStyle(el),
              bar = getComputedStyle(el, "::-webkit-scrollbar");
            return (
              (el.scrollHeight > el.clientHeight + 1 ||
                el.scrollWidth > el.clientWidth + 1) &&
              [style.overflow, style.overflowY, style.overflowX].some((v) =>
                ["auto", "scroll"].includes(v),
              ) &&
              style.scrollbarWidth !== "none" &&
              bar.display !== "none" &&
              bar.width !== "0px"
            );
          }),
        ),
        false,
      );
    await capture("missing-glyph-compact-en");
    await resize(1360, 1000, "restore after compact brand preflight");
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await card
      .getByRole("button", { name: "Edit & publish version", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByRole("button", { name: "Products & offers", exact: true })
      .click();
    await modal
      .getByLabel("Valid until", { exact: true })
      .fill("2021-01-01T00:00");
    await modal
      .getByRole("button", { name: "Publish brand version", exact: true })
      .click();
    await modal.waitFor({ state: "detached" });
    await card.getByText("BRAND · v3", { exact: true }).waitFor();
    await card
      .getByRole("button", { name: "Versions & preflight", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal
      .getByLabel("Referenced fact (optional)", { exact: true })
      .selectOption("offer");
    await modal
      .getByRole("button", { name: "Check fonts & facts", exact: true })
      .click();
    await modal
      .locator(".brand-error-details")
      .filter({ hasText: "BRAND_FACT_UNAVAILABLE" })
      .waitFor();
    await capture("expired-offer-en");
    pass(
      repo +
        " reports an actual missing Unicode glyph and expired offer; compact keyboard access has no horizontal overflow" +
        (repo === "desktop" ? " or visible scrollbar rails" : ""),
    );
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByTitle("切換至繁體中文", { exact: true }).click();
    await setTheme("dark");
    await card
      .getByRole("button", { name: "版本與出圖檢查", exact: true })
      .click();
    await modal
      .getByRole("heading", { name: "品牌版本與出圖檢查", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    await capture("preflight-zh-dark");
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByTitle("Switch to English", { exact: true }).click();
    await setTheme("light");
    pass(
      repo +
        " preserves brand versions and preflight across English, Traditional Chinese and dark theme",
    );
  } finally {
    media = await recording.stop();
    if (repo === "desktop")
      await page.evaluate((url) => {
        location.hash = new URL(url).hash;
      }, previous.url);
  }
  return media;
}
