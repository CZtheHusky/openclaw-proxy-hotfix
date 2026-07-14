#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "test", "fixtures", "openclaw-unpatched");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hotfix-test-"));
const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hotfix-backups-"));
copyDir(fixture, temp);
const originals = snapshotDist(temp);

const cli = path.join(root, "bin", "openclaw-proxy-hotfix.mjs");
run(["check"], { expectStatus: 2 });
run(["apply"]);
run(["check"]);
await assertLatestScopedAuthStoreBridge(temp);
run(["apply"]);
run(["restore"]);
run(["check"], { expectStatus: 2 });
assert.deepEqual(snapshotDist(temp), originals, "restore must recover every original dist file");

const broken = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hotfix-broken-"));
copyDir(fixture, broken);
const brokenRunAttempt = path.join(broken, "dist", "run-attempt-fixture.js");
fs.writeFileSync(
  brokenRunAttempt,
  fs.readFileSync(brokenRunAttempt, "utf8").replace(
    "\t\tagentDir: params.agentDir,",
    "\t\tresolvedAgentDir: params.agentDir,"
  )
);
const brokenBefore = snapshotDist(broken);
run(["apply"], { expectStatus: 1, packageRoot: broken });
assert.deepEqual(snapshotDist(broken), brokenBefore, "failed preflight must not partially patch dist files");

console.log("fixture tests passed");

function run(args, options = {}) {
  const child = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_HOTFIX_PACKAGE_ROOT: options.packageRoot ?? temp,
      OPENCLAW_HOTFIX_BACKUP_ROOT: backupRoot
    }
  });
  const expected = options.expectStatus ?? 0;
  if (child.status !== expected) {
    console.error(child.stdout);
    console.error(child.stderr);
    throw new Error(`${args.join(" ")} exited ${child.status}, expected ${expected}`);
  }
}

async function assertLatestScopedAuthStoreBridge(packageRoot) {
  const shared = fs.readFileSync(path.join(packageRoot, "dist", "shared-client-fixture.js"), "utf8");
  const runAttempt = fs.readFileSync(path.join(packageRoot, "dist", "run-attempt-fixture.js"), "utf8");
  assert.match(shared, /authProfileId: usesNativeAuth \? null : authProfileId,\n\t\t\tauthProfileStore,/);
  assert.match(shared, /authProfileId: usesNativeAuth \? void 0 : authProfileId,\n\t+authProfileStore,/);
  assert.match(shared, /existing\.context = context\.authProfileStore \|\| !existing\.context\.authProfileStore \? context : \{ \.\.\.context, authProfileStore: existing\.context\.authProfileStore \};/);
  assert.match(runAttempt, /authProfileId: params\.startupAuthProfileId,\n\t\tauthProfileStore: params\.authProfileStore,\n\t\tagentDir/);
  assert.match(runAttempt, /startupEnvApiKeyCacheKey,\n\t\tauthProfileStore: params\.authProfileStore,\n\t\tagentDir/);

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(shared).toString("base64")}`;
  const { ensureCodexAppServerClientRuntime } = await import(moduleUrl);
  const handlers = [];
  const client = { addRequestHandler: (handler) => handlers.push(handler) };
  const scopedStore = { version: 1, profiles: {} };
  ensureCodexAppServerClientRuntime(client, {
    agentDir: "/agent",
    authProfileId: "profile",
    authProfileStore: scopedStore
  });
  ensureCodexAppServerClientRuntime(client, {
    agentDir: "/agent",
    authProfileId: "profile"
  });
  const refreshResult = await handlers[0]({ method: "account/chatgptAuthTokens/refresh" });
  assert.equal(
    refreshResult.authProfileStore,
    scopedStore,
    "a later shared-client lease must not discard the active scoped auth store"
  );
}

function snapshotDist(packageRoot) {
  const dist = path.join(packageRoot, "dist");
  return Object.fromEntries(fs.readdirSync(dist).sort().map((name) => [
    name,
    fs.readFileSync(path.join(dist, name), "utf8")
  ]));
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
