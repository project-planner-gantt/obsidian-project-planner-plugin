import { Plugin, TFile, Notice, type WorkspaceLeaf } from "obsidian";
import { PlannerView, VIEW_TYPE } from "./view";
import "@project-planner/core/fonts.css";
import "@project-planner/core/styles.css";
import "./styles.css";

export default class ProjectGanttPlugin extends Plugin {
  private documents: { leaf: WorkspaceLeaf; file: TFile }[] = [];
  private quitting = false;
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE, leaf => new PlannerView(leaf));
    // Cleanup callbacks run in reverse order, before onunload. Capture files
    // before registerView's cleanup detaches the leaves on plugin disable.
    this.register(() => {
      this.documents = this.app.workspace.getLeavesOfType(VIEW_TYPE).flatMap(leaf => {
        const file = (leaf.view as PlannerView).file;
        return file ? [{ leaf, file }] : [];
      });
    });
    this.registerEvent(this.app.workspace.on("quit", () => { this.quitting = true; }));
    this.addRibbonIcon("chart-gantt", "Project Gantt — открыть текущий файл в Гантте", () => this.openCurrentFile(false));
    for (const beside of [false, true]) {
      this.addCommand({
        id: beside ? "open-planner-beside" : "open-planner",
        name: beside ? "Открыть Project Gantt рядом с заметкой" : "Открыть текущий файл в Гантте",
        icon: "chart-gantt",
        // Global callbacks remain available in command pickers even when the
        // picker/settings panel temporarily has focus instead of the document.
        callback: () => this.openCurrentFile(beside),
      });
    }
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      menu.addItem(item => item.setTitle("Открыть в Project Gantt").setIcon("chart-gantt").onClick(() => this.open(file, true)));
    }));
  }
  private openCurrentFile(beside: boolean): Promise<void> | void {
    const file = this.app.workspace.getActiveFile();
    if (file?.extension !== "md") {
      new Notice("Сначала откройте Markdown-файл проекта");
      return;
    }
    return this.open(file, beside);
  }
  private async open(file: TFile, beside: boolean): Promise<void> {
    try {
      const leaf = this.app.workspace.getLeaf(beside ? "split" : false);
      await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { new Notice(`Не удалось открыть планировщик: ${error}`); }
  }
  onunload(): void {
    if (this.quitting) return;
    // Obsidian has already detached disabled custom views by this point.
    for (const { leaf, file } of this.documents) {
      if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) continue;
      let existing: WorkspaceLeaf | undefined;
      this.app.workspace.iterateAllLeaves(candidate => { if (candidate === leaf) existing = candidate; });
      const target = existing ?? this.app.workspace.getLeaf("tab");
      void target.setViewState({ type: "markdown", state: { file: file.path } })
        .catch(error => new Notice(`Не удалось вернуть Markdown: ${error}`));
    }
    this.documents = [];
  }
}
