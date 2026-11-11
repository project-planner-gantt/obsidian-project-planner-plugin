import { describe, it, expect } from "vitest";
import type { App } from "obsidian";
import { TFile, MarkdownView } from "./obsidian";
import { ObsidianStorage } from "../src/storage";
import { ProjectStore, StaleEditError } from "@project-planner/core/core/store";
import { DEFAULT_SETTINGS } from "@project-planner/core/core/types";
import { renameTask } from "@project-planner/core/core/edits";

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
