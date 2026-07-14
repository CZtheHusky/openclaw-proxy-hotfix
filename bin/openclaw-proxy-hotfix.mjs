#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROXY_ENV_KEYS = [
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY"
];

const PATCH_NAMES = {
  oauth: "oauth-token-env-proxy",
  policy: "tui-chat-terminal-network-proxy",
  shared: "codex-shared-client-refresh-bridge"
};

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "check") {
    const ctx = discoverContext();
    printCheck(checkAll(ctx), ctx);
    return;
  }
  if (command === "apply") {
    const ctx = discoverContext();
    const result = applyAll(ctx);
    printApply(result, ctx);
    return;
  }
  if (command === "verify") {
    const full = args.includes("--full");
    const ctx = discoverContext();
    verify(ctx, { full });
    return;
  }
  if (command === "restore") {
    const ctx = discoverContext({ allowMissingFiles: true });
    restore(ctx, args[0]);
    return;
  }
  throw new Error(`unknown command "${command}". Run "openclaw-proxy-hotfix help".`);
}

function printHelp() {
  console.log(`OpenClaw proxy hotfix

Usage:
  openclaw-proxy-hotfix check
  openclaw-proxy-hotfix apply
  openclaw-proxy-hotfix verify [--full]
  openclaw-proxy-hotfix restore [backup-dir]

Environment:
  OPENCLAW_HOTFIX_PACKAGE_ROOT  Override OpenClaw package root for tests.
  OPENCLAW_HOTFIX_BACKUP_ROOT   Override backup root for tests.
`);
}

function discoverContext(options = {}) {
  const packageRoot = resolvePackageRoot();
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packageJsonPath)) throw new Error(`OpenClaw package.json not found at ${packageJsonPath}`);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const distDir = path.join(packageRoot, "dist");
  if (!fs.existsSync(distDir)) throw new Error(`OpenClaw dist directory not found at ${distDir}`);
  const files = options.allowMissingFiles ? {} : findPatchFiles(distDir);
  return {
    packageRoot,
    distDir,
    version: String(packageJson.version ?? "unknown"),
    files
  };
}

function resolvePackageRoot() {
  const override = process.env.OPENCLAW_HOTFIX_PACKAGE_ROOT?.trim();
  if (override) return path.resolve(expandHome(override));

  const binPath = findExecutableOnPath("openclaw");
  if (!binPath) throw new Error("openclaw not found on PATH");

  const candidates = [];
  const realBin = fs.realpathSync(binPath);
  for (let current = path.dirname(realBin); current && current !== path.dirname(current); current = path.dirname(current)) {
    candidates.push(current);
    candidates.push(path.join(current, "lib", "node_modules", "openclaw"));
  }
  candidates.push(path.join(path.dirname(path.dirname(binPath)), "lib", "node_modules", "openclaw"));

  for (const candidate of unique(candidates)) {
    const pkgPath = path.join(candidate, "package.json");
    const distPath = path.join(candidate, "dist");
    if (!fs.existsSync(pkgPath) || !fs.existsSync(distPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.name === "openclaw" || candidate.endsWith(`${path.sep}openclaw`)) return candidate;
    } catch {}
  }
  throw new Error(`could not resolve OpenClaw package root from ${binPath}`);
}

function findExecutableOnPath(name) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

function findPatchFiles(distDir) {
  const jsFiles = walk(distDir).filter((file) => file.endsWith(".js"));
  const oauth = findOne(jsFiles, (file, text) => (
    text.includes("https://auth.openai.com/oauth/token") &&
    text.includes("openai-chatgpt-oauth-token")
  ), "OpenAI ChatGPT OAuth runtime");
  const policy = findOne(jsFiles, (file, text) => (
    text.includes("function resolveCliNetworkProxyPolicy") &&
    text.includes('commandPath: ["tui"]')
  ), "CLI command path policy");
  const shared = findOne(jsFiles, (file, text) => (
    text.includes("function acquireSharedCodexAppServerClient") &&
    text.includes("function createIsolatedCodexAppServerClient") &&
    text.includes("account/chatgptAuthTokens/refresh")
  ), "Codex app-server shared client");
  const runAttempt = findOne(jsFiles, (file, text) => (
    text.includes("async function startCodexAttemptThread") &&
    text.includes("startupClient = await params.attemptClientFactory({") &&
    text.includes("const startupAuthProfileId = params.authProfileStore")
  ), "Codex app-server run attempt");
  return { oauth, policy, shared, runAttempt };
}

function findOne(files, predicate, label) {
  const matches = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (predicate(file, text)) matches.push(file);
  }
  if (matches.length !== 1) throw new Error(`${label}: expected exactly 1 match, found ${matches.length}`);
  return matches[0];
}

function checkAll(ctx) {
  return {
    [PATCH_NAMES.oauth]: checkOAuth(ctx.files.oauth),
    [PATCH_NAMES.policy]: checkPolicy(ctx.files.policy),
    [PATCH_NAMES.shared]: checkShared(ctx.files.shared, ctx.files.runAttempt)
  };
}

function printCheck(checks, ctx) {
  console.log(`OpenClaw: ${ctx.version}`);
  console.log(`Package:  ${ctx.packageRoot}`);
  for (const [name, result] of Object.entries(checks)) {
    const files = (result.files ?? [result.file]).map((file) => path.relative(ctx.packageRoot, file)).join(", ");
    console.log(`${result.ok ? "ok " : "MISS"} ${name} (${files})`);
    if (!result.ok) console.log(`     ${result.reason}`);
  }
  if (!Object.values(checks).every((entry) => entry.ok)) process.exitCode = 2;
}

function checkOAuth(file) {
  const text = fs.readFileSync(file, "utf8");
  const ok = text.includes("shouldUseEnvHttpProxyForUrl(TOKEN_URL)") &&
    text.includes("withTrustedEnvProxyGuardedFetchMode(guardedOptions)") &&
    text.includes('auditContext: "openai-chatgpt-oauth-token"');
  return {
    file,
    ok,
    reason: ok ? "" : "token exchange is not wrapped in trusted env proxy mode"
  };
}

function checkPolicy(file) {
  const text = fs.readFileSync(file, "utf8");
  const ok = text.includes('commandPath: ["chat"],\n\t\tpolicy: { networkProxy: "default" }') &&
    text.includes('commandPath: ["terminal"],\n\t\tpolicy: { networkProxy: "default" }') &&
    text.includes('commandPath: ["tui"],\n\t\tpolicy: { networkProxy: ({ argv }) => hasFlag(argv, "--local") ? "default" : "bypass" }');
  return {
    file,
    ok,
    reason: ok ? "" : "tui/chat/terminal command policy does not start managed proxy"
  };
}

function checkShared(file, runAttemptFile) {
  const sharedOk = checkSharedText(fs.readFileSync(file, "utf8"));
  const runAttemptOk = checkRunAttemptText(fs.readFileSync(runAttemptFile, "utf8"));
  const ok = sharedOk && runAttemptOk;
  return {
    file,
    files: [file, runAttemptFile],
    ok,
    reason: ok ? "" : !sharedOk ?
      "shared Codex app-server client drops the scoped auth profile store" :
      "Codex run attempt does not carry the scoped auth profile store into the shared client"
  };
}

function applyAll(ctx) {
  const before = checkAll(ctx);
  const targets = {
    oauth: ctx.files.oauth,
    policy: ctx.files.policy,
    shared: ctx.files.shared,
    runAttempt: ctx.files.runAttempt
  };
  const pending = Object.entries(before).filter(([, result]) => !result.ok);
  if (pending.length === 0) return { changed: false, backupDir: null, changedFiles: [] };

  const rendered = {};
  for (const [key, file] of Object.entries(targets)) {
    const oldText = fs.readFileSync(file, "utf8");
    const newText = key === "oauth" ? patchOAuth(oldText, ctx.distDir) :
      key === "policy" ? patchPolicy(oldText) :
      key === "shared" ? patchShared(oldText) :
      patchRunAttempt(oldText);
    if (newText !== oldText) nodeCheckText(newText, file);
    rendered[key] = { file, oldText, newText };
  }

  const backupDir = createBackup(ctx, Object.values(targets));
  const changedFiles = [];
  for (const { file, oldText, newText } of Object.values(rendered)) {
    if (newText !== oldText) {
      fs.writeFileSync(file, newText);
      changedFiles.push(file);
      nodeCheck(file);
    }
  }

  const after = checkAll(ctx);
  const misses = Object.entries(after).filter(([, result]) => !result.ok);
  if (misses.length > 0) throw new Error(`patch incomplete: ${misses.map(([name]) => name).join(", ")}`);
  return { changed: changedFiles.length > 0, backupDir, changedFiles };
}

function printApply(result, ctx) {
  if (!result.changed) {
    console.log("already patched");
    return;
  }
  console.log(`patched OpenClaw ${ctx.version}`);
  console.log(`backup: ${result.backupDir}`);
  for (const file of result.changedFiles) console.log(`changed: ${path.relative(ctx.packageRoot, file)}`);
}

function patchOAuth(text, distDir) {
  if (checkTextOAuth(text)) return text;
  const proxyEnvImport = resolveProxyEnvImport(distDir);

  let next = text;
  if (!next.includes("shouldUseEnvHttpProxyForUrl")) {
    next = `${proxyEnvImport}\n${next}`;
  }
  next = next.replace(
    /import \{ r as fetchWithSsrFGuard \} from "(\.\/fetch-guard-[^"]+\.js)";/,
    'import { o as withTrustedEnvProxyGuardedFetchMode, r as fetchWithSsrFGuard } from "$1";'
  );
  if (!next.includes("withTrustedEnvProxyGuardedFetchMode")) {
    throw new Error("OAuth runtime: failed to add trusted env proxy import");
  }

  const directFetch = /const \{ response, release \} = await fetchWithSsrFGuard\(\{\n\t\turl: TOKEN_URL,\n\t\tinit: \{\n\t\t\tmethod: "POST",\n\t\t\theaders: \{ "Content-Type": "application\/x-www-form-urlencoded" \},\n\t\t\tbody\n\t\t\},\n\t\ttimeoutMs,\n\t\tsignal: options\.signal,\n\t\tauditContext: "openai-chatgpt-oauth-token"\n\t\}\);/;
  const replacement = `const guardedOptions = {
\t\turl: TOKEN_URL,
\t\tinit: {
\t\t\tmethod: "POST",
\t\t\theaders: { "Content-Type": "application/x-www-form-urlencoded" },
\t\t\tbody
\t\t},
\t\ttimeoutMs,
\t\tsignal: options.signal,
\t\tauditContext: "openai-chatgpt-oauth-token"
\t};
\tconst { response, release } = await fetchWithSsrFGuard(shouldUseEnvHttpProxyForUrl(TOKEN_URL) ? withTrustedEnvProxyGuardedFetchMode(guardedOptions) : guardedOptions);`;
  next = next.replace(directFetch, replacement);
  if (!checkTextOAuth(next)) throw new Error("OAuth runtime: expected direct token fetch shape was not found");
  return next;
}

function checkTextOAuth(text) {
  return text.includes("shouldUseEnvHttpProxyForUrl(TOKEN_URL)") &&
    text.includes("withTrustedEnvProxyGuardedFetchMode(guardedOptions)");
}

function resolveProxyEnvImport(distDir) {
  const matches = fs.readdirSync(distDir).filter((name) => /^proxy-env-.*\.js$/.test(name));
  for (const name of matches) {
    const text = fs.readFileSync(path.join(distDir, name), "utf8");
    if (text.includes("shouldUseEnvHttpProxyForUrl as c")) {
      return `import { c as shouldUseEnvHttpProxyForUrl } from "./${name}";`;
    }
  }
  throw new Error("OAuth runtime: could not find proxy-env chunk exporting shouldUseEnvHttpProxyForUrl as c");
}

function patchPolicy(text) {
  let next = text;
  next = next.replace(
    'commandPath: ["chat"],\n\t\tpolicy: { networkProxy: "bypass" }',
    'commandPath: ["chat"],\n\t\tpolicy: { networkProxy: "default" }'
  );
  next = next.replace(
    'commandPath: ["terminal"],\n\t\tpolicy: { networkProxy: "bypass" }',
    'commandPath: ["terminal"],\n\t\tpolicy: { networkProxy: "default" }'
  );
  next = next.replace(
    'commandPath: ["tui"],\n\t\tpolicy: { networkProxy: "bypass" }',
    'commandPath: ["tui"],\n\t\tpolicy: { networkProxy: ({ argv }) => hasFlag(argv, "--local") ? "default" : "bypass" }'
  );
  if (!checkPolicyText(next)) throw new Error("command policy: expected chat/terminal/tui policy shape was not found");
  return next;
}

function checkPolicyText(text) {
  return text.includes('commandPath: ["chat"],\n\t\tpolicy: { networkProxy: "default" }') &&
    text.includes('commandPath: ["terminal"],\n\t\tpolicy: { networkProxy: "default" }') &&
    text.includes('commandPath: ["tui"],\n\t\tpolicy: { networkProxy: ({ argv }) => hasFlag(argv, "--local") ? "default" : "bypass" }');
}

function patchShared(text) {
  if (checkSharedText(text)) return text;
  let next = text.replace(
    "\t\texisting.context = context;",
    "\t\texisting.context = context.authProfileStore || !existing.context.authProfileStore ? context : { ...context, authProfileStore: existing.context.authProfileStore };"
  );
  const start = next.indexOf("async function acquireSharedCodexAppServerClient");
  const end = next.indexOf("async function createIsolatedCodexAppServerClient");
  if (start < 0 || end < 0 || end <= start) throw new Error("shared client: acquire/create function boundary not found");
  let acquire = next.slice(start, end);
  acquire = acquire.replace(
    "const { agentDir, usesNativeAuth, authProfileId, startOptions } = await resolveCodexAppServerClientStartContext(options);",
    "const { agentDir, usesNativeAuth, authProfileId, authProfileStore, startOptions } = await resolveCodexAppServerClientStartContext(options);"
  );
  acquire = acquire.replace(
    "\t\t\tauthProfileId: usesNativeAuth ? null : authProfileId,\n\t\t\tconfig: options?.config,",
    "\t\t\tauthProfileId: usesNativeAuth ? null : authProfileId,\n\t\t\tauthProfileStore,\n\t\t\tconfig: options?.config,"
  );
  acquire = acquire.replace(
    "\t\t\tauthProfileId: usesNativeAuth ? void 0 : authProfileId,\n\t\t\tconfig: options?.config\n\t\t});",
    "\t\t\tauthProfileId: usesNativeAuth ? void 0 : authProfileId,\n\t\t\tauthProfileStore,\n\t\t\tconfig: options?.config\n\t\t});"
  );
  next = `${next.slice(0, start)}${acquire}${next.slice(end)}`;
  if (!checkSharedText(next)) throw new Error("shared client: expected runtime/acquire client shape was not found");
  return next;
}

function checkSharedText(text) {
  const acquire = sliceBetween(text, "async function acquireSharedCodexAppServerClient", "async function createIsolatedCodexAppServerClient");
  return acquire.includes("authProfileStore, startOptions") &&
    acquire.includes("authProfileId: usesNativeAuth ? null : authProfileId,\n\t\t\tauthProfileStore,\n\t\t\tconfig: options?.config") &&
    acquire.includes("authProfileId: usesNativeAuth ? void 0 : authProfileId,\n\t\t\tauthProfileStore,\n\t\t\tconfig: options?.config") &&
    text.includes("function ensureCodexAppServerClientRuntime") &&
    text.includes("existing.context = context.authProfileStore || !existing.context.authProfileStore ? context : { ...context, authProfileStore: existing.context.authProfileStore };") &&
    text.includes('request.method !== "account/chatgptAuthTokens/refresh"') &&
    text.includes("refreshCodexAppServerAuthTokens({");
}

function patchRunAttempt(text) {
  if (checkRunAttemptText(text)) return text;
  let next = text;
  next = next.replace(
    /(\n(\t*)authProfileId: params\.startupAuthProfileId,\n)\2agentDir: params\.agentDir,/,
    "$1$2authProfileStore: params.authProfileStore,\n$2agentDir: params.agentDir,"
  );
  next = next.replace(
    /(\n(\t*)authProfileId: params\.startupAuthProfileId,\n)\2config: params\.config\n/,
    "$1$2authProfileStore: params.authProfileStore,\n$2config: params.config\n"
  );
  next = next.replace(
    /(\n(\t*)startupEnvApiKeyCacheKey,\n)\2agentDir,/,
    "$1$2authProfileStore: params.authProfileStore,\n$2agentDir,"
  );
  if (!checkRunAttemptText(next)) throw new Error("run attempt: expected shared auth profile store flow was not found");
  return next;
}

function checkRunAttemptText(text) {
  return /authProfileId: params\.startupAuthProfileId,\n\t+authProfileStore: params\.authProfileStore,\n\t+agentDir: params\.agentDir/.test(text) &&
    /authProfileId: params\.startupAuthProfileId,\n\t+authProfileStore: params\.authProfileStore,\n\t+config: params\.config/.test(text) &&
    /startupEnvApiKeyCacheKey,\n\t+authProfileStore: params\.authProfileStore,\n\t+agentDir,/.test(text);
}

function createBackup(ctx, files) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(resolveBackupRoot(), `${ctx.version}-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const entries = [];
  for (const file of unique(files)) {
    const rel = path.relative(ctx.packageRoot, file);
    const backupPath = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(file, backupPath);
    entries.push({
      file,
      relativePath: rel,
      backupPath,
      sha256: sha256File(file)
    });
  }
  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    packageRoot: ctx.packageRoot,
    version: ctx.version,
    entries
  }, null, 2));
  return backupDir;
}

function restore(ctx, backupArg) {
  const backupDir = backupArg ? path.resolve(expandHome(backupArg)) : latestBackupDir();
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`backup manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const entry of manifest.entries ?? []) {
    const target = entry.file && path.isAbsolute(entry.file) ? entry.file : path.join(ctx.packageRoot, entry.relativePath);
    if (!fs.existsSync(entry.backupPath)) throw new Error(`backup file missing: ${entry.backupPath}`);
    fs.copyFileSync(entry.backupPath, target);
    console.log(`restored: ${target}`);
  }
  console.log(`restored from: ${backupDir}`);
}

function latestBackupDir() {
  const root = resolveBackupRoot();
  const entries = fs.existsSync(root) ? fs.readdirSync(root).map((name) => path.join(root, name)).filter((p) => fs.statSync(p).isDirectory()) : [];
  entries.sort();
  const latest = entries.at(-1);
  if (!latest) throw new Error(`no backups found under ${root}`);
  return latest;
}

function resolveBackupRoot() {
  const override = process.env.OPENCLAW_HOTFIX_BACKUP_ROOT?.trim();
  return override ? path.resolve(expandHome(override)) : path.join(os.homedir(), ".openclaw", "hotfix-backups");
}

function verify(ctx, options) {
  const checks = checkAll(ctx);
  printCheck(checks, ctx);
  if (!Object.values(checks).every((entry) => entry.ok)) throw new Error("hotfix checks failed");
  verifyProxyConfig();
  runOpenClaw(["proxy", "validate"], { label: "openclaw proxy validate" });
  if (options.full) {
    runOpenClaw([
      "agent",
      "--local",
      "--session-key",
      `agent:main:hotfix-verify-${Date.now()}`,
      "--message",
      "Reply with the single word pong.",
      "--timeout",
      "120",
      "--json"
    ], {
      label: "clean-env openclaw agent probe",
      cleanProxyEnv: true,
      expect: /"text":\s*"pong"|"finalAssistantVisibleText":\s*"pong"/
    });
  }
  console.log(options.full ? "verify --full passed" : "verify passed");
}

function verifyProxyConfig() {
  const result = runOpenClaw(["config", "get", "proxy", "--json"], {
    label: "openclaw config get proxy",
    capture: true
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("could not parse proxy config JSON");
  }
  if (parsed.enabled !== true) throw new Error("proxy.enabled is not true");
  if (typeof parsed.proxyUrl !== "string" || !/^https?:\/\//.test(parsed.proxyUrl)) {
    throw new Error("proxy.proxyUrl is missing or not HTTP(S)");
  }
  console.log(`proxy config ok: ${parsed.proxyUrl}`);
}

function runOpenClaw(args, options = {}) {
  const env = { ...process.env };
  if (options.cleanProxyEnv) for (const key of PROXY_ENV_KEYS) delete env[key];
  const child = spawnSync("openclaw", args, {
    encoding: "utf8",
    env,
    timeout: options.timeoutMs ?? 180000,
    maxBuffer: 20 * 1024 * 1024
  });
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  if (!options.capture) {
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
  }
  if (child.error) throw new Error(`${options.label ?? "openclaw"} failed: ${child.error.message}`);
  if (child.status !== 0) throw new Error(`${options.label ?? "openclaw"} exited ${child.status}`);
  if (options.expect && !options.expect.test(stdout) && !options.expect.test(stderr)) {
    throw new Error(`${options.label ?? "openclaw"} did not produce expected output`);
  }
  return { stdout, stderr };
}

function nodeCheck(file) {
  const child = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (child.status !== 0) throw new Error(`node --check failed for ${file}: ${child.stderr || child.stdout}`);
}

function nodeCheckText(source, file) {
  const child = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    encoding: "utf8",
    input: source
  });
  if (child.status !== 0) throw new Error(`node --check failed for patched ${file}: ${child.stderr || child.stdout}`);
}

function walk(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return "";
  return text.slice(start, end);
}

function unique(values) {
  return [...new Set(values)];
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
