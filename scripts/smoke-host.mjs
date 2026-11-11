// Exercise the built plugin in a browser with a minimal Obsidian API double.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const server = createServer((req,res) => {
  const path = req.url === "/" ? "scripts/host-fixture.html" : req.url.slice(1);
  if (!["scripts/host-fixture.html","dist/main.js","dist/styles.css"].includes(path)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : path.endsWith("js") ? "text/javascript" : "text/html; charset=utf-8");
  res.end(readFileSync(resolve(path)));
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const port = server.address().port, debugPort = 9334;
const browser = spawn(process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", [
  "--headless=new","--disable-gpu",`--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(),"planner-host-"))}`,"--window-size=1800,900",`http://127.0.0.1:${port}`,
],{stdio:"ignore"});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
let ws, seq=0, failed=0; const pending=new Map();
const errors=[];
function send(method,params={}) {
  return new Promise((resolve,reject) => {
    const id=++seq;
    const timeout=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},15000);
    pending.set(id,msg=>{clearTimeout(timeout);resolve(msg);}); ws.send(JSON.stringify({id,method,params}));
  });
}
async function run(fn,...args) {
  const result=await send("Runtime.evaluate",{expression:`(${fn})(...${JSON.stringify(args)})`,awaitPromise:true,returnByValue:true});
  if(result.result.exceptionDetails) throw Error(result.result.exceptionDetails.exception?.description??JSON.stringify(result.result.exceptionDetails));
  return result.result.result.value;
}
function check(name,ok,details="") { console.log(`${ok?"PASS":"FAIL"} ${name} ${details}`);if(!ok)failed++; }
try {
  let target;
  for(let i=0;i<40&&!target;i++) {
    await sleep(250);try {target=(await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(t=>t.type==="page");}catch{}
  }
  if(!target) throw Error("Headless Edge did not start");
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.onopen=resolve);
  ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);}if(msg.method==="Runtime.exceptionThrown")errors.push(msg.params.exceptionDetails.exception?.description);};
  await send("Runtime.enable");
  await send("Page.reload");
  for(let i=0;i<60;i++) { if(await run(()=>typeof window.start==='function')) break; await sleep(100); }
  if(!await run(()=>typeof window.start==='function')) throw Error(`Fixture did not load: ${errors.join("\n")}`);
  if(errors.length) throw Error(errors.join("\n"));
  await run(()=>window.start());await sleep(500);
  check("built CommonJS plugin mounts two document views",await run(()=>document.querySelectorAll('.pp-scope').length===2));
  check("plugin has no file dialogs, recent projects or HTML export",await run(()=>!document.querySelector('.pp-recent,.pp-export')&&![...document.querySelectorAll('.pp-toolbar button')].some(b=>b.textContent.includes('Открыть'))));
  const colors=await run(()=>[...document.querySelectorAll('.pp-scope')].map(root=>getComputedStyle(root.querySelector('.wx-bar[data-id=":a"]')).backgroundColor));
  check("per-project colors stay isolated with identical task IDs",colors[0]==='rgb(255, 0, 0)'&&colors[1]==='rgb(0, 0, 255)',JSON.stringify(colors));
  await run(()=>{
    const row=document.querySelectorAll('.pp-scope')[0].querySelector('.wx-row[data-id=":a"]');
    row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  });await sleep(150);
  check("task card belongs to its document container",await run(()=>document.querySelectorAll('.pp-scope')[0].querySelectorAll('.pp-dialog').length===1&&document.querySelectorAll('.pp-scope')[1].querySelectorAll('.pp-dialog').length===0));
  await run(()=>{
    const form=document.querySelector('.pp-dialog'),input=form.querySelector('input');
    input.value='Edited alpha';input.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();
  });await sleep(250);
  check("card save edits only the source Markdown document",await run(()=>host.texts.get('alpha.md').includes('Edited alpha')&&host.texts.get('beta.md').includes('Beta task')));
  await run(()=>host.plugin.open(host.files.get('alpha.md'),true));await sleep(250);
  await run(()=>{
    const file=host.files.get('alpha.md');host.texts.set(file.path,host.texts.get(file.path).replace('Edited alpha','External edit'));host.app.vault.emit('modify',file);
  });await sleep(250);
  check("two views of one file reload external edits",await run(()=>[host.leaves[0],host.leaves[2]].every(l=>l.view.store.state.plan.rows.some(r=>r.text.includes('External edit')))));
  await run(()=>{
    document.querySelectorAll('.pp-scope')[0].querySelector('.wx-row[data-id=":a"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  });await sleep(100);
  await run(()=>{
    const file=host.files.get('alpha.md');host.texts.set(file.path,host.texts.get(file.path)+'\nExternal note');host.app.vault.emit('modify',file);
  });await sleep(150);
  await run(()=>{
    const form=document.querySelector('.pp-dialog'),input=form.querySelector('input');input.value='Stale card';input.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();
  });await sleep(150);
  check("stale task card cannot overwrite a newer document",await run(()=>!host.texts.get('alpha.md').includes('Stale card')&&host.texts.get('alpha.md').includes('External note')&&document.querySelector('.pp-notice')?.textContent.includes('отменена')));
  await run(()=>{
    for(const root of [...document.querySelectorAll('.pp-scope')].slice(0,2)) root.querySelector('.wx-row[data-id=":a"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  });await sleep(100);
  await run(()=>document.querySelectorAll('.pp-scope')[1].querySelector('.pp-dialog input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  await sleep(100);
  check("Escape closes only the dialog in its own planner",await run(()=>document.querySelectorAll('.pp-scope')[0].querySelector('.pp-dialog')!==null&&document.querySelectorAll('.pp-scope')[1].querySelector('.pp-dialog')===null));
  await run(()=>document.querySelectorAll('.pp-scope')[0].querySelector('.pp-dialog input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  check("changing panel width keeps a measurable chart",await run(()=>{
    host.leaves[1].el.style.maxWidth='450px';return host.leaves[1].el.querySelector('.pp-gantt').getBoundingClientRect().height>200;
  }));
  await sleep(100);
  check("narrow panes retain the task-name column",await run(()=>[...host.leaves[1].el.querySelectorAll('.wx-cell')].find(cell=>cell.textContent.trim()==='Задача')?.getBoundingClientRect().width>=150));
  await run(()=>{
    document.body.style.setProperty('--background-primary','#202020');document.body.style.setProperty('--background-secondary','#303030');document.body.style.setProperty('--text-normal','#ddd');
  });
  check("host theme colors reach the planner container",await run(()=>getComputedStyle(document.querySelector('.pp-scope')).backgroundColor==='rgb(32, 32, 32)'));
  check("host theme colors reach the SVAR grid",await run(()=>getComputedStyle(document.querySelector('.wx-willow-theme')).getPropertyValue('--wx-background').trim()==='#202020'));
  const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(tmpdir(),'planner-plugin-smoke.png'),Buffer.from(screenshot.result.data,'base64'));
  await run(async()=>{
    const view=host.leaves[0].view;
    await Promise.all([view.onLoadFile(host.files.get('alpha.md')),view.onLoadFile(host.files.get('beta.md'))]);
  });await sleep(100);
  check("overlapping document loads keep only the latest component",await run(()=>host.leaves[0].el.querySelectorAll('.pp-scope').length===1&&host.leaves[0].view.store.state.path==='beta.md'));
  await run(()=>host.leaves[0].view.onLoadFile(host.files.get('alpha.md')));
  await run(async()=>{
    const leaf=host.leaves[1],file=host.files.get('beta.md');host.files.delete('beta.md');host.app.vault.emit('delete',file);await leaf.view.onUnloadFile(file);
  });
  check("unloading a deleted file removes its component",await run(()=>!host.leaves[1].el.querySelector('.pp-scope')));
  await run(async()=>{const file=host.files.get('alpha.md');host.files.delete(file.path);file.path='renamed.md';host.files.set(file.path,file);host.texts.set(file.path,host.texts.get('alpha.md'));for(const leaf of [host.leaves[0],host.leaves[2]])await leaf.view.onRename(file);});await sleep(100);
  check("renaming a document rebinds its store",await run(()=>[host.leaves[0],host.leaves[2]].every(l=>l.view.store.state.path==='renamed.md')));
  await run(async()=>{for(const leaf of host.leaves)if(leaf.view)await leaf.view.onClose();});
  check("closing views removes document and metadata subscriptions",await run(()=>host.app.vault.refs.size===0&&host.app.metadataCache.refs.size===0));
  await run(async()=>{await host.plugin.open(host.files.get('renamed.md'),true);host.plugin.unload();});
  await sleep(100);
  check("plugin disable preserves documents after view-registration cleanup",await run(()=>host.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view.file?.path==='renamed.md')&&host.app.workspace.getLeavesOfType('project-gantt-view').length===0));
  check("no uncaught browser exceptions",errors.length===0,errors.join('\n'));
}catch(error){console.error(error);failed++;}
finally{ws?.close();browser.kill();server.close();}
process.exitCode=failed?1:0;
