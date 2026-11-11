// Windows integration runner. Never registers the test vault in the user's profile.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { connect } from "./cdp.mjs";

if (process.platform !== "win32") throw Error("The owned Obsidian launcher currently supports Windows only");
const binary = process.env.OBSIDIAN_BINARY ?? [
  join(process.env.LOCALAPPDATA, "Programs", "Obsidian", "Obsidian.exe"),
  join(process.env.LOCALAPPDATA, "Obsidian", "Obsidian.exe"),
].find(existsSync);
if (!binary || !existsSync(binary)) throw Error("Set OBSIDIAN_BINARY to the installed Obsidian.exe");

mkdirSync(".test-runtime", { recursive: true });
const root = mkdtempSync(resolve(".test-runtime", "obsidian-"));
const profile = join(root, "profile"), vault = join(root, "vault");
const pluginDir = join(vault, ".obsidian", "plugins", "project-gantt");
mkdirSync(profile, { recursive: true }); mkdirSync(pluginDir, { recursive: true });
for (const name of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join("dist", name), join(pluginDir, name));
for (const name of ["demo-project.md", "external.md"]) copyFileSync(join("..", "project-planner-core", "samples", name), join(vault, name));
writeFileSync(join(vault, ".obsidian", "community-plugins.json"), '["project-gantt"]');
writeFileSync(join(profile, "obsidian.json"), JSON.stringify({ vaults: { "planner-e2e": { path: vault, ts: Date.now(), open: true } }, disableAutoUpdates: true }));

// Reuse the already-installed application package; never copy personal settings.
const installedProfile = join(process.env.APPDATA, "obsidian");
const asars = existsSync(installedProfile) ? readdirSync(installedProfile).filter(name => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(name)) : [];
asars.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const asar = process.env.OBSIDIAN_ASAR ?? (asars.length ? join(installedProfile, asars[0]) : null);
if (asar) copyFileSync(asar, join(profile, `obsidian-${/\d+\.\d+\.\d+/.exec(asar)?.[0] ?? "0.0.0"}.asar`));

const server = createServer();
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const psQuote = text => `'${String(text).replaceAll("'", "''")}'`;
const argumentLine = `"--user-data-dir=${profile}" --remote-debugging-port=${port} --remote-debugging-address=127.0.0.1 --disable-gpu --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --no-first-run`;
const pid = Number(execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `(Start-Process -FilePath ${psQuote(binary)} -ArgumentList ${psQuote(argumentLine)} -WindowStyle Hidden -PassThru).Id`,
], { encoding: "utf8", windowsHide: true }).trim());
const config = { root, profile, vault, port, pid, binary, asar };
writeFileSync(".test-runtime/current.json", JSON.stringify(config, null, 2));
writeFileSync(join(root, "run.json"), JSON.stringify(config, null, 2));
console.log(`Isolated Obsidian test: ${root}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let exitCode = 1;
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    let connection;
    try {
      connection = await connect(port, target => target.url.startsWith("app://obsidian.md"));
      ready = await connection.evaluate("typeof app !== 'undefined' && !!app.workspace.layoutReady");
    } catch {} finally { connection?.close(); }
    if (!ready) await sleep(200);
  }
  if (!ready) throw Error("The isolated Obsidian instance did not load in 30 seconds");
  exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/test-real-obsidian.mjs"], { stdio: "inherit", windowsHide: true });
    child.on("error", reject); child.on("exit", code => resolve(code ?? 1));
  });
} finally {
  let connection;
  try {
    connection = await connect(port, target => target.url.startsWith("app://obsidian.md"));
    const actual = await connection.evaluate("require('@electron/remote').app.getPath('userData')");
    if (actual.toLowerCase() !== profile.toLowerCase()) throw Error("Refusing to close an unrelated profile");
    await connection.evaluate("setTimeout(() => require('@electron/remote').app.quit(), 100); true");
  } catch (error) {
    console.error(`Graceful shutdown unavailable: ${error.message}`);
    // Stop only the process we launched, after rechecking its executable and profile.
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$ownedProcess = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($ownedProcess -and $ownedProcess.ExecutablePath -eq ${psQuote(binary)} -and $ownedProcess.CommandLine.Contains(${psQuote(profile)})) { Stop-Process -Id ${pid} }`,
    ], { windowsHide: true });
  } finally { connection?.close(); }
  console.log(`Results retained in ${join(root, "results.json")}`);
}
process.exitCode = exitCode;
