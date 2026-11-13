import { EditableFileView, Notice, setTooltip, type TFile, type WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { mount, unmount } from "svelte";
import Planner from "@project-planner/core/ui";
import { ProjectStore } from "@project-planner/core/core/store";
import { DEFAULT_SETTINGS } from "@project-planner/core/core/types";
import type { GridLayout } from "@project-planner/core/ui/ganttConfig";
import { ObsidianStorage } from "./storage";
import { translator, type Language } from "@project-planner/core/core/i18n";

export const VIEW_TYPE = "project-gantt-view";
export class PlannerView extends EditableFileView {
  private component: ReturnType<typeof mount> | null = null;
  private store: ProjectStore | null = null;
  private layout: GridLayout = { widths: {}, gridWidth: null };
  private revision = 0;
  private markdownAction: HTMLElement;
  constructor(leaf: WorkspaceLeaf, private language: () => Language = () => "en") {
    super(leaf);
    this.markdownAction = this.addAction("file-text", translator(this.language())("Open as Markdown"), () => {
      if (this.file) void this.leaf.setViewState({ type: "markdown", state: { file: this.file.path } });
    });
    this.markdownAction.addClass("project-gantt-markdown-action");
  }
  getViewType(): string { return VIEW_TYPE; }
  async refreshLanguage(): Promise<void> {
    if (this.file) await this.onLoadFile(this.file);
  }
  getDisplayText(): string { return this.file ? `${this.file.basename} · Project Gantt` : "Project Gantt"; }
  getIcon(): string { return "chart-gantt"; }
  getState(): Record<string, unknown> { return { ...super.getState(), plannerLayout: this.layout }; }
  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    const layout = state.plannerLayout as GridLayout | undefined;
    if (layout && typeof layout.widths === "object" && layout.widths !== null) {
      this.layout = {
        widths: Object.fromEntries(Object.entries(layout.widths).filter(([, width]) => Number.isFinite(width) && width > 0)),
        gridWidth: typeof layout.gridWidth === "number" && layout.gridWidth > 0 ? layout.gridWidth : null,
      };
    }
    await super.setState(state, result);
  }

  async onLoadFile(file: TFile): Promise<void> {
    setTooltip(this.markdownAction, translator(this.language())("Open as Markdown"));
    const revision = await this.dispose();
    if (revision !== this.revision) return;
    this.contentEl.addClass("project-gantt-view");
    const store = new ProjectStore(new ObsidianStorage(this.app, translator(this.language())), DEFAULT_SETTINGS);
    this.store = store;
    try {
      await store.open(file.path);
      if (revision !== this.revision) { store.close(); return; }
      this.component = mount(Planner, {
        target: this.contentEl,
        props: {
          store, language: this.language(), initialLayout: this.layout,
          onlayoutchange: (layout: GridLayout) => { this.layout = layout; this.app.workspace.requestSaveLayout(); },
        },
      });
    } catch (error) {
      store.close();
      if (revision !== this.revision) return;
      const message = `${translator(this.language())("Failed to open project")}: ${String(error)}`;
      new Notice(message);
      this.contentEl.createEl("p", { text: message });
    }
  }
  async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
    await this.onLoadFile(file);
  }
  async onUnloadFile(): Promise<void> { await this.dispose(); }
  async onClose(): Promise<void> { await this.dispose(); }
  private async dispose(): Promise<number> {
    const revision = ++this.revision;
    this.store?.close(); this.store = null;
    const component = this.component; this.component = null;
    if (component) await unmount(component);
    if (revision === this.revision) this.contentEl.empty();
    return revision;
  }
}
