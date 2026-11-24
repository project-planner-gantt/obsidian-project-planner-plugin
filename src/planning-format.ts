import type { TFile } from "obsidian";
import { parseFrontmatter, parseTaskLine } from "@project-planner/core/core/parser";
import { ensureBlockIds, normalizeTaskTags } from "@project-planner/core/core/edits";
import { DEFAULT_SETTINGS, type TaskLine } from "@project-planner/core/core/types";
import { StaleEditError } from "@project-planner/core/core/store";
import { ObsidianStorage } from "./storage";

/** Format only opted-in documents, excluding frontmatter and fenced examples. */
export function formatPlanningDocument(content: string, path: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const { frontmatter, bodyStart } = parseFrontmatter(lines);
  if (!frontmatter || (frontmatter as Record<string, unknown>).is_planning !== true) return content;
  const tasks: TaskLine[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const marker = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { marker: marker[1][0], length: marker[1].length }; continue; }
    const task = parseTaskLine(lines[i], i, path, DEFAULT_SETTINGS);
    if (task) tasks.push(task);
  }
  return ensureBlockIds(normalizeTaskTags(lines, tasks), tasks).join(eol);
}

/** Serialize per file; our own modify event becomes an inexpensive no-op. */
export class PlanningSaveFormatter {
  private pending = new Map<string, Promise<void>>();
  private stopped = false;
  constructor(private storage: ObsidianStorage) {}
  stop(): void { this.stopped = true; }
  format(file: Pick<TFile, "path" | "extension">): Promise<void> {
    if (this.stopped || file.extension !== "md") return Promise.resolve();
    const path = file.path;
    const work = (this.pending.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.stopped || !await this.storage.exists(path)) return;
      const content = await this.storage.readText(path);
      if (this.stopped || formatPlanningDocument(content, path) === content) return;
      try {
        await this.storage.updateText(path, fresh => this.stopped ? fresh : formatPlanningDocument(fresh, path));
      } catch (error) {
        // A newer editor buffer will be handled by its next save.
        if (!(error instanceof StaleEditError)) throw error;
      }
    });
    this.pending.set(path, work);
    void work.finally(() => { if (this.pending.get(path) === work) this.pending.delete(path); }).catch(() => {});
    return work;
  }
}
