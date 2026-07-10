#!/usr/bin/env node
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

const cli = path.join(root, "bin", "openclaw-proxy-hotfix.mjs");
run(["check"], { expectStatus: 2 });
run(["apply"]);
run(["check"]);
run(["apply"]);
run(["restore"]);
run(["check"], { expectStatus: 2 });

console.log("fixture tests passed");

function run(args, options = {}) {
  const child = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      OPENCLAW_HOTFIX_PACKAGE_ROOT: temp,
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

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
