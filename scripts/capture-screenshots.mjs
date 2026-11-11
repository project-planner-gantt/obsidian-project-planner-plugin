import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./cdp.mjs";
import { spawn } from "node:child_process";

// Use the tested host setup, including Obsidian's first-run trust flow.
const testCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/test-real-obsidian.mjs'], { stdio: 'inherit', windowsHide: true });
  child.on('error', reject); child.on('exit', code => resolve(code));
});
if (testCode !== 0) throw Error('Obsidian integration setup failed');

const run = JSON.parse(readFileSync(".test-runtime/current.json", "utf8"));
const connection = await connect(run.port, target => target.url.startsWith("app://obsidian.md"));
const evaluate = (fn, ...args) => connection.evaluate(`(${fn})(...${JSON.stringify(args)})`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) { if (await evaluate(fn)) return; await sleep(150); }
  throw Error("Screenshot view did not become ready: " + await evaluate(() => JSON.stringify({text:document.body.innerText.slice(-1000),bars:document.querySelectorAll('.wx-bar').length,language:app.plugins.plugins['project-gantt']?.language})));
}
try {
  const actual = await evaluate(() => require('@electron/remote').app.getPath('userData'));
  if (actual.toLowerCase() !== run.profile.toLowerCase()) throw Error("Refusing to capture a personal profile");
  await connection.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await waitFor(() => !!app.plugins.plugins['project-gantt']);
  console.log('Plugin ready');
  await evaluate(async () => {
    const win = require('@electron/remote').getCurrentWindow();
    win.webContents.setBackgroundThrottling(false);
    win.setSize(1600, 1000);
    win.hide();
    app.vault.setConfig('theme', 'moonstone');
    document.body.removeClass('theme-dark'); document.body.addClass('theme-light');
    const plugin = app.plugins.plugins['project-gantt'];
    await plugin.setLanguage('en');
    const file = app.vault.getAbstractFileByPath('demo-project.md');
    await app.workspace.getLeaf(false).openFile(file);
    await plugin.open(file, false);
    const target = app.workspace.getLeavesOfType('project-gantt-view').find(leaf => leaf.view.file?.path === file.path);
    if (!target) throw Error('Demo chart was not opened');
    const otherLeaves = [];
    app.workspace.iterateAllLeaves(leaf => { if (leaf !== target && leaf.getRoot() === app.workspace.rootSplit) otherLeaves.push(leaf); });
    for (const leaf of otherLeaves) leaf.detach();
    await app.workspace.revealLeaf(target);
    app.workspace.leftSplit.collapse();
  });
  await waitFor(() => document.querySelectorAll('.wx-bar').length >= 10);
  await evaluate(async () => { await app.plugins.plugins['project-gantt'].setLanguage('en'); });
  await waitFor(() => document.querySelectorAll('.wx-bar').length >= 10);
  await waitFor(() => [...document.querySelectorAll('.pp-toolbar button')].some(button => button.textContent === 'Today'));
  console.log('English chart ready');
  await evaluate(() => {
    const zoom = document.querySelector('.pp-toolbar button[title="Narrower days"]');
    for (let i = 0; i < 3; i++) zoom.click();
  });
  await sleep(5000);
  console.log('Chart ready');
  await evaluate(async () => { await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 2000))]); });
  await sleep(600);
  async function capture(name) {
    console.log(`Capturing ${name}`);
    const png = await evaluate(async () => {
      const win = require('@electron/remote').getCurrentWindow();
      // A fully hidden WebView may stop producing frames. Paint an invisible,
      // non-focused window briefly, then return it to its hidden state.
      win.setOpacity(0.01);
      win.showInactive();
      try {
        await new Promise(resolve => setTimeout(resolve, 700));
        const image = await win.webContents.capturePage(undefined, { stayAwake: true });
        return image.toPNG().toString('base64');
      } finally { win.hide(); win.setOpacity(1); }
    });
    for (const dir of ['docs/images', '../project-planner-core/docs/images']) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), Buffer.from(png, 'base64'));
    }
    console.log(`Captured ${name}`);
  }
  await capture('project-gantt-overview.png');
  await evaluate(() => document.querySelector('.wx-row[data-id=":ui-editor"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  await waitFor(() => !!document.querySelector('form.pp-dialog input'));
  await sleep(300);
  await capture('project-gantt-task-editor.png');
} finally { connection.close(); }
