import { Plugin, TFile, Notice, getLanguage, type WorkspaceLeaf } from "obsidian";
import { languagePreference, resolveLanguage, translator, type LanguagePreference } from "@project-planner/core/core/i18n";
import { GanttSettingsTab } from "./settings";
import { PlannerView, VIEW_TYPE } from "./view";
import "@project-planner/core/fonts.css";
import "@project-planner/core/styles.css";
import "./styles.css";

export default class ProjectGanttPlugin extends Plugin {
  private documents: { leaf: WorkspaceLeaf; file: TFile }[] = [];
  private quitting = false;
  preference: LanguagePreference = "system";
  private savedSettings: Record<string, unknown> = {};
  private ribbon?: HTMLElement;
  private settingsTab!: GanttSettingsTab;
  get language() { return resolveLanguage(this.preference, getLanguage()); }
  private text(value: string) { return translator(this.language)(value); }
  async setLanguage(preference: LanguagePreference): Promise<void> {
    const next = languagePreference(preference);
    await this.saveData({ ...this.savedSettings, language: next });
    this.savedSettings = { ...this.savedSettings, language: next };
    this.preference = next;
    for (const beside of [false, true]) {
      this.removeCommand(beside ? "open-planner-beside" : "open-planner");
      this.addPlannerCommand(beside);
    }
    await Promise.all(this.app.workspace.getLeavesOfType(VIEW_TYPE).map(leaf => (leaf.view as PlannerView).refreshLanguage()));
  }
  private addPlannerCommand(beside: boolean): void {
    this.addCommand({ id: beside ? "open-planner-beside" : "open-planner",
      name: this.text(beside ? "Open Gantt beside current note" : "Open current file as Gantt"),
      icon: "chart-gantt", callback: () => this.openCurrentFile(beside) });
  }
  async onload(): Promise<void> {
    const loaded = await this.loadData();
    this.savedSettings = loaded && typeof loaded === "object" && !Array.isArray(loaded) ? loaded : {};
    this.preference = languagePreference(this.savedSettings.language);
    this.settingsTab = new GanttSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.registerView(VIEW_TYPE, leaf => new PlannerView(leaf, () => this.language));
    // Cleanup callbacks run in reverse order, before onunload. Capture files
    // before registerView's cleanup detaches the leaves on plugin disable.
    this.register(() => {
      this.documents = this.app.workspace.getLeavesOfType(VIEW_TYPE).flatMap(leaf => {
        const file = (leaf.view as PlannerView).file;
        return file ? [{ leaf, file }] : [];
      });
    });
    this.registerEvent(this.app.workspace.on("quit", () => { this.quitting = true; }));
    this.ribbon = this.addRibbonIcon("chart-gantt", "Project Gantt", () => this.openCurrentFile(false));
    for (const beside of [false, true]) {
      this.addPlannerCommand(beside);
    }
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      menu.addItem(item => item.setTitle(this.text("Open in Project Gantt")).setIcon("chart-gantt").onClick(() => this.open(file, true)));
    }));
  }
  private openCurrentFile(beside: boolean): Promise<void> | void {
    const file = this.app.workspace.getActiveFile();
    if (file?.extension !== "md") {
      new Notice(this.text("Open a Markdown project file first"));
      return;
    }
    return this.open(file, beside);
  }
  private async open(file: TFile, beside: boolean): Promise<void> {
    try {
      const leaf = this.app.workspace.getLeaf(beside ? "split" : false);
      await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { new Notice(`${this.text("Failed to open planner")}: ${error}`); }
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
        .catch(error => new Notice(`${this.text("Failed to restore Markdown view")}: ${error}`));
    }
    this.documents = [];
  }
}
