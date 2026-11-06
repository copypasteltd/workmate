import assert from "node:assert/strict";
import test from "node:test";
import { desktopSetup, desktopPortable, downloadSize, productDownloads } from "../src/product-downloads";

test("public download catalog provides distinct installers and valid verification metadata", () => {
  const artifacts = [desktopSetup, desktopPortable, productDownloads.extension.artifact];
  const releaseDirectory = productDownloads.checksums_url.slice(0, productDownloads.checksums_url.lastIndexOf("/") + 1);
  assert.match(releaseDirectory, /^\/downloads\/releases\/\d+\/$/);
  assert.equal(new Set(artifacts.map(a => a.url)).size, 3);
  for (const artifact of artifacts) {
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0);
    assert.equal(artifact.url, releaseDirectory + artifact.name);
    assert.ok(!artifact.url.includes("?"));
  }
  assert.match(desktopSetup.name, /-Setup\.exe$/);
  assert.match(desktopPortable.name, /-Portable\.exe$/);
  assert.match(productDownloads.extension.artifact.name, /\.zip$/);
  assert.equal(productDownloads.extension.installation, "unpacked");
  assert.equal(productDownloads.extension.store_url, null);
  assert.equal(productDownloads.desktop.signed, false);
});

test("download sizes are readable for both installers and the extension", () => {
  assert.equal(downloadSize(345714), "338 KB");
  assert.equal(downloadSize(184695790), "176.1 MB");
});
