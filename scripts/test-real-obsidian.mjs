import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "./cdp.mjs";

const run = JSON.parse(readFileSync(".test-runtime/current.json", "utf8"));
const connection = await connect(run.port, target => target.url.startsWith("app://obsidian.md"));
const evaluate = (fn, ...args) => connection.evaluate(`(${fn})(...${JSON.stringify(args)})`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(fn)) return;
    await sleep(150);
  }
  throw Error(`Timed out: ${description}`);
}
let failed = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, passed: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " " + JSON.stringify(detail) : ""}`);
  if (!ok) failed++;
}
try {
  const profile = await evaluate(() => require('@electron/remote').app.getPath('userData'));
  if (profile.toLowerCase() !== run.profile.toLowerCase()) throw Error("Refusing to test a non-isolated Obsidian profile");
  await evaluate(() => {
    const win = require('@electron/remote').getCurrentWindow();
    win.webContents.setBackgroundThrottling(false);
    win.hide();
  });
  await connection.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const trusted = await evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(el => /Довериться автору|Trust author/i.test(el.textContent));
    button?.click();
    return !!button;
  });
  await evaluate(async () => {
    await app.plugins.enablePluginAndSave('project-gantt');
    // Close earlier views in this test vault only, so runs can be inspected again.
    for (const leaf of app.workspace.getLeavesOfType('project-gantt-view')) leaf.detach();
    const source = '# Integration\n\n## Work\n\n- [ ] First ⏳ 2026-11-11 📅 2026-11-15 ^a\n- [ ] Second ⏳ 2026-11-16 📅 2026-11-18 ^b\n';
    const path = `integration-${Date.now()}.md`;
    const file = await app.vault.create(path, source);
    window.plannerTest = { file, path, source, errors: [] };
    window.addEventListener('unhandledrejection', event => plannerTest.errors.push(String(event.reason)));
    window.addEventListener('error', event => plannerTest.errors.push(event.message));
    await app.workspace.getLeaf(false).openFile(file);
    app.commands.executeCommandById('project-gantt:open-planner-beside');
  });
  check('current-file command is global and available to quick-command pickers', await evaluate(() => {
    const command = app.commands.commands['project-gantt:open-planner'];
    return typeof command?.callback === 'function' && !command.checkCallback && command.icon === 'chart-gantt' && command.name.includes('Открыть текущий файл в Гантте');
  }));
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').some(leaf => leaf.view.store?.state?.path === plannerTest.file.path && leaf.view.contentEl.querySelector('.wx-row[data-id=":a"]')), 'initial Gantt');
  await evaluate(() => {
    plannerTest.leaf = app.workspace.getLeavesOfType('project-gantt-view').find(leaf => leaf.view.store?.state?.path === plannerTest.file.path);
    plannerTest.markdown = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file === plannerTest.file);
  });
  check('actual plugin loads beside Markdown', await evaluate(() => !!plannerTest.markdown && !!plannerTest.leaf.view.contentEl.querySelector('.wx-bar')));
  check('vault and profile are isolated', (await evaluate(() => app.vault.adapter.getBasePath())).toLowerCase() === run.vault.toLowerCase(), run.vault);
  check('plugin has no file-opening controls', await evaluate(() => !plannerTest.leaf.view.contentEl.querySelector('.pp-recent,.pp-export')));
  check('left ribbon contains the current-file Gantt button', await evaluate(() => !!document.querySelector('.side-dock-ribbon-action[aria-label="Project Gantt — открыть текущий файл в Гантте"]')));
  await evaluate(() => {
    app.workspace.setActiveLeaf(plannerTest.markdown, { focus: true });
    document.querySelector('.side-dock-ribbon-action[aria-label="Project Gantt — открыть текущий файл в Гантте"]').click();
  });
  await waitFor(() => plannerTest.markdown.view.getViewType() === 'project-gantt-view' && !!plannerTest.markdown.view.store?.state, 'ribbon opens current file');
  check('left ribbon button opens the current Markdown file in Gantt', true);
  await evaluate(() => plannerTest.markdown.view.containerEl.querySelector('.view-action[aria-label="Открыть Markdown"]').click());
  await waitFor(() => plannerTest.markdown.view.getViewType() === 'markdown' && !!plannerTest.markdown.view.editor, 'return from ribbon-opened Gantt');
  await evaluate(() => {
    app.workspace.setActiveLeaf(plannerTest.markdown, { focus: true });
    app.commands.executeCommandById('project-gantt:open-planner');
  });
  await waitFor(() => plannerTest.markdown.view.getViewType() === 'project-gantt-view' && !!plannerTest.markdown.view.store?.state, 'replace Markdown with Gantt');
  check('command switches the current Markdown tab to Gantt', true);
  await evaluate(() => {
    const action = plannerTest.markdown.view.containerEl.querySelector('.view-action[aria-label="Открыть Markdown"]');
    if (!action) throw Error('Return to Markdown action not found');
    action.click();
  });
  await waitFor(() => plannerTest.markdown.view.getViewType() === 'markdown' && !!plannerTest.markdown.view.editor, 'return to Markdown');
  check('view action switches Gantt back to Markdown', true);

  async function openCard() {
    await waitFor(() => !!plannerTest.leaf.view.contentEl.querySelector('.wx-row[data-id=":a"]'), 'task row');
    await evaluate(() => plannerTest.leaf.view.contentEl.querySelector('.wx-row[data-id=":a"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => !!plannerTest.leaf.view.contentEl.querySelector('.pp-dialog input'), 'task dialog');
  }
  async function saveCard(title) {
    await evaluate(title => {
      const form = plannerTest.leaf.view.contentEl.querySelector('form.pp-dialog');
      const input = form.querySelector('input');
      input.value = title; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit();
    }, title);
  }
  await openCard(); await saveCard('Card saved in Obsidian');
  await waitFor(async () => (await app.vault.read(plannerTest.file)).includes('Card saved in Obsidian'), 'card save to disk');
  await waitFor(() => plannerTest.markdown.view.editor.getValue().includes('Card saved in Obsidian'), 'Markdown editor update');
  check('task card writes the actual file and updates Markdown', true);

  await evaluate(() => plannerTest.markdown.view.editor.setValue(plannerTest.markdown.view.editor.getValue().replace('Card saved in Obsidian', 'Edited as Markdown')));
  await waitFor(() => plannerTest.leaf.view.store.state.plan.rows.some(row => row.text.includes('Edited as Markdown')), 'Markdown autosave refresh');
  check('Markdown autosave refreshes the Gantt', true);

  const conflict = await evaluate(async () => {
    const store = plannerTest.leaf.view.store;
    const anchor = store.state.plan.rows.find(row => row.id === 'a').task;
    plannerTest.markdown.view.editor.setValue(plannerTest.markdown.view.editor.getValue() + '\nUnsaved Markdown note');
    try { await store.apply([anchor], lines => lines.map(line => line.replace('Edited as Markdown', 'Losing Gantt edit'))); return false; }
    catch (error) { return error.message.includes('отменена'); }
  });
  check('unsaved Markdown rejects a competing Gantt write', conflict);
  await waitFor(async () => (await app.vault.read(plannerTest.file)).includes('Unsaved Markdown note'), 'unsaved editor content reaches disk');
  check('rejected edit preserves the Markdown changes', await evaluate(async () => !(await app.vault.read(plannerTest.file)).includes('Losing Gantt edit')));

  await openCard();
  await evaluate(async () => app.vault.process(plannerTest.file, text => text + '\nExternal note'));
  await waitFor(() => plannerTest.leaf.view.store.state.content.includes('External note'), 'external change while dialog open');
  await saveCard('Stale card content');
  check('stale card cannot overwrite a newer file', await evaluate(async () => !(await app.vault.read(plannerTest.file)).includes('Stale card content')));

  await evaluate(async () => app.plugins.plugins['project-gantt'].open(plannerTest.file, true));
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').length === 2, 'second Gantt view');
  await evaluate(async () => app.vault.process(plannerTest.file, text => text.replace('Edited as Markdown', 'Two views updated')));
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').every(leaf => leaf.view.store?.state?.content.includes('Two views updated')), 'two views reload');
  check('two actual views synchronize one document', true);

  await evaluate(async () => {
    const leaf = plannerTest.leaf;
    await leaf.setViewState({ type: 'project-gantt-view', state: { file: plannerTest.file.path, plannerLayout: { widths: { text: 380 }, gridWidth: 440 } } });
    await app.workspace.requestSaveLayout.run();
  });
  check('view layout survives setViewState', await evaluate(() => plannerTest.leaf.view.getState().plannerLayout.widths.text === 380));

  await evaluate(async () => {
    const file = plannerTest.file;
    await app.fileManager.renameFile(file, file.path.replace('.md', '-renamed.md'));
  });
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').every(leaf => leaf.view.store?.state?.path === plannerTest.file.path), 'rename in actual host');
  check('renaming a file rebinds all Gantt views', true);

  await evaluate(async () => {
    document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark');
    const metadataFile = await app.vault.create('integration-child-' + Date.now() + '.md', '- [ ] Linked task 📅 2026-11-17 ^linked');
    plannerTest.child = metadataFile;
    await app.vault.process(plannerTest.file, text => text + '\n![[' + metadataFile.basename + ']]');
  });
  await waitFor(() => plannerTest.leaf.view.store.state.plan.rows.some(row => row.id === 'linked'), 'actual metadata resolution');
  check('Obsidian metadata resolves embedded task files', true);
  check('dark theme reaches the SVAR container', await evaluate(() => {
    const root = plannerTest.leaf.view.contentEl;
    const theme = root.querySelector('.wx-willow-theme');
    return getComputedStyle(theme).getPropertyValue('--wx-background').trim() === getComputedStyle(document.body).getPropertyValue('--background-primary').trim();
  }));

  await evaluate(async () => {
    plannerTest.renamePath = plannerTest.file.path;
    await app.workspace.requestSaveLayout.run();
    window.localStorage.setItem('planner-e2e-file', plannerTest.file.path);
    window.__plannerReloadMarker = true;
  });
  // Reload the actual renderer to restore views from Obsidian's workspace file.
  await connection.send('Page.reload');
  await waitFor(() => !window.__plannerReloadMarker && typeof app !== 'undefined' && !!app?.workspace?.layoutReady && !!app?.plugins?.plugins?.['project-gantt'], 'host reload', 25000);
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').length === 2 && app.workspace.getLeavesOfType('project-gantt-view').every(leaf => leaf.view.store?.state), 'restored views');
  check('Obsidian restores Gantt views after reload', true);
  check('Obsidian restores column widths after reload', await evaluate(() => app.workspace.getLeavesOfType('project-gantt-view').some(leaf => leaf.view.getState().plannerLayout.widths.text === 380)));

  await evaluate(async () => {
    const path = window.localStorage.getItem('planner-e2e-file');
    window.plannerDeleted = app.workspace.getLeavesOfType('project-gantt-view').map(leaf => leaf.view);
    await app.vault.delete(app.vault.getAbstractFileByPath(path));
  });
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').length === 0, 'deletion closes views');
  check('deleting a document unloads its Gantt views', await evaluate(() => plannerDeleted.every(view => view.store === null && !view.contentEl.querySelector('.pp-scope'))));

  await evaluate(async () => {
    const file = app.vault.getAbstractFileByPath('demo-project.md');
    await app.plugins.plugins['project-gantt'].open(file, true);
  });
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').length === 1, 'view before disable');
  await evaluate(async () => {
    window.plannerBeforeDisable = app.workspace.getLeavesOfType('project-gantt-view')[0].view;
    await app.plugins.disablePluginAndSave('project-gantt');
  });
  await waitFor(() => app.workspace.getLeavesOfType('project-gantt-view').length === 0, 'plugin disable');
  check('disabling the plugin returns documents to Markdown', await evaluate(() => app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view.file?.path === 'demo-project.md')));
  check('disabled plugin releases its document store', await evaluate(() => plannerBeforeDisable.store === null));
  await evaluate(async () => app.plugins.enablePluginAndSave('project-gantt'));
  check('plugin can be enabled again', await evaluate(() => !!app.plugins.plugins['project-gantt']));
} catch (error) {
  console.error(error); results.push({ name: 'unexpected error', passed: false, detail: String(error) }); failed++;
} finally {
  writeFileSync(join(run.root, 'results.json'), JSON.stringify(results, null, 2));
  connection.close();
}
process.exitCode = failed ? 1 : 0;
