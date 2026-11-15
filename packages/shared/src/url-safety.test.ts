import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, isSafeWebhookUrl } from "./url-safety";

test("private, loopback, link-local, and reserved addresses are blocked", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "0:0:0:0:0:0:0:1",
    "0000:0000:0000:0000:0000:0000:0000:0000",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::127.0.0.1",
    "2002:7f00:1::",
    "2001:0:0:0:0:0:0:1",
    "100::1",
  ]) {
    assert.equal(isBlockedAddress(address), true, `${address} should be blocked`);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "203.0.114.1", "2001:4860:4860::8888", "2a00:1450:4001:80f::200e"]) {
    assert.equal(isBlockedAddress(address), false, `${address} should be allowed`);
  }
});

test("webhook URLs must be HTTPS and must not target private hosts", async () => {
  assert.equal(await isSafeWebhookUrl("https://hooks.example.com/docuflow"), true);
  assert.equal(await isSafeWebhookUrl("http://hooks.example.com/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://user:pass@hooks.example.com/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://localhost/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://service.internal/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://[::1]/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://[0:0:0:0:0:0:0:1]/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://[fe80::1]/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://127.0.0.1/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://172.16.4.2/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("https://2130706433/docuflow"), false);
  assert.equal(await isSafeWebhookUrl("not a url"), false);
});

test("optional DNS resolution rejects hostnames that resolve to private addresses", async () => {
  assert.equal(await isSafeWebhookUrl("https://localhost/docuflow", { resolveDns: true }), false);
  assert.equal(await isSafeWebhookUrl("https://docuflow.invalid/docuflow", { resolveDns: true }), false);
});
