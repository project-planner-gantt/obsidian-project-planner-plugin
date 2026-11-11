import { MarkdownView, TFile, type App } from "obsidian";
import { StaleEditError } from "@project-planner/core/core/store";
import type { DocumentStorage } from "@project-planner/core/core/document";
import type { Translate } from "@project-planner/core/core/i18n";

/** All paths are vault-relative. Never access the filesystem outside Obsidian. */
export class ObsidianStorage implements DocumentStorage {
  constructor(private app: App, private t: Translate = text => text) {}
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`${this.t("File not found")}: ${path}`);
    return file;
  }
  async readText(path: string): Promise<string> { return this.app.vault.read(this.file(path)); }
  async writeText(path: string, content: string): Promise<void> {
    await this.updateText(path, () => content);
  }
  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }
  async resolveLink(name: string, fromPath: string): Promise<string | null> {
    return this.app.metadataCache.getFirstLinkpathDest(name, fromPath)?.path ?? null;
  }
  async updateText(path: string, update: (fresh: string) => string): Promise<string> {
    const file = this.file(path);
    return this.app.vault.process(file, fresh => {
      // A Markdown editor may contain changes that haven't reached Vault yet.
      // Refuse the Gantt edit until Obsidian saves them, rather than overwrite them.
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === path && view.editor.getValue() !== fresh) {
          throw new StaleEditError();
        }
      }
      return update(fresh);
    });
  }
  async watch(path: string, onChange: (force?: boolean) => void): Promise<() => void> {
    const refs = [
      this.app.vault.on("modify", file => { if (file.path === path) onChange(); }),
      this.app.vault.on("rename", (file, oldPath) => { if (file.path === path || oldPath === path) onChange(); }),
      this.app.vault.on("delete", file => { if (file.path === path) onChange(); }),
      this.app.vault.on("create", () => onChange(true)),
    ];
    // Metadata resolution can change after a linked file is renamed or created.
    const resolved = this.app.metadataCache.on("resolved", () => onChange(true));
    return () => {
      refs.forEach(ref => this.app.vault.offref(ref));
      this.app.metadataCache.offref(resolved);
    };
  }
}
