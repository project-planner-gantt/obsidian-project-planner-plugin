import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile, MarkdownView } from "./obsidian";
import { ObsidianStorage } from "../src/storage";
import { ProjectStore, StaleEditError } from "@project-planner/core/core/store";
import { DEFAULT_SETTINGS } from "@project-planner/core/core/types";
import { renameTask } from "@project-planner/core/core/edits";
import { PlanningSaveFormatter, formatPlanningDocument } from "../src/planning-format";

function host() {
  const files = new Map([["plan.md", new TFile("plan.md")], ["folder/child.md", new TFile("folder/child.md")]]);
  const text = new Map([["plan.md", "# Plan\n- [ ] Original 📅 2026-11-12 ^a"], ["folder/child.md", "- [ ] Child 📅 2026-11-12 ^child"]]);
  let leaves: { view: MarkdownView }[] = [];
  const handlers = new Set<{ name: string; callback: (...args: any[]) => void }>();
  const events = {
    on(name: string, callback: (...args: any[]) => void) { const ref = { name, callback }; handlers.add(ref); return ref; },
    offref(ref: any) { handlers.delete(ref); },
  };
  const app = {
    vault: { ...events,
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      read: async (file: TFile) => text.get(file.path)!,
      process: async (file: TFile, fn: (fresh: string) => string) => {
        const next = fn(text.get(file.path)!); text.set(file.path, next); return next;
      },
    },
    workspace: { getLeavesOfType: () => leaves },
    metadataCache: { ...events, getFirstLinkpathDest: (name: string) => name === "Child" ? files.get("folder/child.md") : null },
  } as unknown as App;
  return { app, files, text, handlers, storage: new ObsidianStorage(app),
    setEditor(value: string) { leaves = [{ view: new MarkdownView(files.get("plan.md")!, { getValue: () => value }) }]; },
  };
}

describe("Obsidian storage adapter", () => {
  it("writes a Gantt change through the host's process operation", async () => {
    const h = host(), store = new ProjectStore(h.storage, DEFAULT_SETTINGS);
    await store.open("plan.md");
    const task = store.state!.plan.rows.find(row => row.id === "a")!.task!;
    await store.apply([task], lines => renameTask(lines, task, "Updated"));
    expect(h.text.get("plan.md")).toContain("Updated"); store.close();
    expect(h.handlers.size).toBe(0);
  });
  it("refuses to overwrite text not yet saved by a Markdown editor", async () => {
    const h = host(); h.setEditor("# Unsaved changes");
    const old = h.text.get("plan.md");
    await expect(h.storage.updateText("plan.md", () => "# Gantt change")).rejects.toBeInstanceOf(StaleEditError);
    expect(h.text.get("plan.md")).toBe(old);
  });
  it("resolves links through metadata rather than assuming a sibling file", async () => {
    const h = host();
    expect(await h.storage.resolveLink("Child", "plan.md")).toBe("folder/child.md");
    expect(await h.storage.resolveLink("Missing", "plan.md")).toBeNull();
  });
  it("unsubscribes all listeners and forces refresh after metadata resolution", async () => {
    const h = host(); const calls: (boolean | undefined)[] = [];
    const stop = await h.storage.watch("plan.md", force => calls.push(force));
    [...h.handlers].find(h => h.name === "resolved")!.callback();
    [...h.handlers].find(h => h.name === "modify")!.callback(h.files.get("plan.md"));
    expect(calls).toEqual([true, undefined]); stop(); expect(h.handlers.size).toBe(0);
  });
  it("rejects reads and writes to a missing or deleted document", async () => {
    const h = host(); h.files.delete("plan.md");
    expect(await h.storage.exists("plan.md")).toBe(false);
    await expect(h.storage.readText("plan.md")).rejects.toThrow("File not found");
    await expect(h.storage.updateText("plan.md", s => s)).rejects.toThrow("File not found");
  });
});

describe("planning save formatting", () => {
  const raw = "---\r\nis_planning: true\r\n---\r\n- [ ] разработка⏳ 2026-11-23 #stage-be #stage-dev 📅 2026-12-07\r\n";
  it("formats opted-in notes without a heading and adds stable IDs", () => {
    const formatted = formatPlanningDocument(raw, "plan.md");
    expect(formatted).toMatch(/разработка #stage-be #stage-dev ⏳ 2026-11-23 📅 2026-12-07 \^task-[\w-]+\r\n$/);
    expect(formatPlanningDocument(formatted, "plan.md")).toBe(formatted);
    expect(formatted.startsWith("---\r\nis_planning: true\r\n---\r\n")).toBe(true);
  });
  it.each(["false", '"true"', "1", "[true]", "null"])("requires boolean true rather than %s", value => {
    const text = raw.replace("is_planning: true", `is_planning: ${value}`);
    expect(formatPlanningDocument(text, "plan.md")).toBe(text);
  });
  it("leaves notes without opt-in, malformed YAML and code examples untouched", () => {
    for (const text of ["- [ ] Task #stage-be", raw.replace("is_planning: true", "is_planning: ["), "---\nnull\n---\n- [ ] Task"]) {
      expect(formatPlanningDocument(text, "plan.md")).toBe(text);
    }
    const examples = "---\nis_planning: true\n---\n```md\n- [ ] Example #stage-be\n```\n~~~\n- [ ] Example #stage-dev\n~~~\n";
    expect(formatPlanningDocument(examples, "plan.md")).toBe(examples);
  });
  it("preserves existing IDs and formats nested and completed tasks", () => {
    const text = "---\nis_planning: true\n---\n- [x] Parent 📅 2026-12-07 #stage-be ^parent\n\t- [-] Child ⛔ ^parent #stage-dev ^child\n";
    expect(formatPlanningDocument(text, "plan.md")).toBe("---\nis_planning: true\n---\n- [x] Parent #stage-be 📅 2026-12-07 ^parent\n\t- [-] Child #stage-dev ⛔ ^parent ^child\n");
  });
  it("handles repeated save notifications without rewriting the formatted file", async () => {
    const h = host(); h.text.set("plan.md", raw);
    const formatter = new PlanningSaveFormatter(h.storage);
    let writes = 0;
    const update = h.storage.updateText.bind(h.storage);
    h.storage.updateText = async (path, transform) => { writes++; return update(path, transform); };
    await Promise.all([formatter.format(h.files.get("plan.md")!), formatter.format(h.files.get("plan.md")!)]);
    expect(writes).toBe(1);
    expect(h.text.get("plan.md")).toContain("разработка #stage-be #stage-dev ⏳");
    formatter.stop();
  });
  it("defers to the next save when the editor has newer changes", async () => {
    const h = host(); h.text.set("plan.md", raw); h.setEditor(raw + "Unsaved");
    const formatter = new PlanningSaveFormatter(h.storage);
    await formatter.format(h.files.get("plan.md")!);
    expect(h.text.get("plan.md")).toBe(raw);
    h.text.set("plan.md", raw + "Unsaved");
    await formatter.format(h.files.get("plan.md")!);
    expect(h.text.get("plan.md")).toContain("разработка #stage-be #stage-dev ⏳");
    expect(h.text.get("plan.md")).toContain("Unsaved");
    formatter.stop();
  });
  it("does not format files after the plugin stops", async () => {
    const h = host(); h.text.set("plan.md", raw);
    const formatter = new PlanningSaveFormatter(h.storage);
    const queued = formatter.format(h.files.get("plan.md")!);
    formatter.stop(); await queued;
    expect(h.text.get("plan.md")).toBe(raw);
  });
});
