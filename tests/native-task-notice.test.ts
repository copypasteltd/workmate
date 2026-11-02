import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeTaskNoticeView } from "../src/native-task-notice-view.js";

test("a native failure renders its client provenance without hiding the independent billing reason", () => {
  const html = renderToStaticMarkup(createElement(NativeTaskNoticeView, { code: "LOCAL_CODEX_STREAM_DISCONNECTED" }));
  assert.match(html, /本機回報原因/);
  assert.match(html, /LOCAL_CODEX_STREAM_DISCONNECTED/);
  assert.match(html, /費用記錄/);
  assert.doesNotMatch(html, /USAGE_RECONCILIATION_REQUIRED/);
  const english = renderToStaticMarkup(createElement(NativeTaskNoticeView, { code: "LOCAL_CODEX_STREAM_DISCONNECTED", t: (_zh, en) => en }));
  assert.match(english, /Reported local cause/);
  assert.match(english, /usage record/);
});

test("missing or unbounded native metadata cannot render arbitrary report content", () => {
  for (const code of [null, undefined, "", "LOCAL_FAILURE\n", "A".repeat(81), "<script>private output</script>"]) {
    assert.equal(renderToStaticMarkup(createElement(NativeTaskNoticeView, { code })), "");
  }
});
