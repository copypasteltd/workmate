import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopClientError, desktopClientErrorSql, isDesktopClientErrorCode } from "../src/desktop-errors.js";

test("only bounded failure codes leave native receipts, with explicit client provenance", () => {
  for (const status of ["failed", "unknown", "interrupted"]) {
    assert.equal(desktopClientError({ status, error_code: "LOCAL_CODEX_STREAM_DISCONNECTED", output: "private content" }), "LOCAL_CODEX_STREAM_DISCONNECTED");
  }
  for (const status of ["completed", "succeeded", "running", undefined])
    assert.equal(desktopClientError({ status, error_code: "LOCAL_CODEX_TURN_FAILED" }), null);
  for (const error_code of ["LOCAL_CODEX_TURN_FAILED\n", " LOCAL_CODEX_TURN_FAILED", "local_failure", "A".repeat(81), "A", { secret: "private" }]) {
    assert.equal(isDesktopClientErrorCode(error_code), false);
    assert.equal(desktopClientError({ status: "failed", error_code }), null);
  }
  for (const report of [null, "private content", [], 1]) assert.equal(desktopClientError(report), null);
  assert.equal(isDesktopClientErrorCode("A".repeat(80)), true);
});

test("native diagnostic projection only accepts fixed SQL aliases", () => {
  assert.match(desktopClientErrorSql("tasks.id"), /native_error\.task_id=tasks\.id/);
  assert.match(desktopClientErrorSql("sourced.id"), /native_error\.task_id=sourced\.id/);
  assert.throws(() => desktopClientErrorSql("request-controlled identifier" as "tasks.id"), /Invalid task projection/);
});
