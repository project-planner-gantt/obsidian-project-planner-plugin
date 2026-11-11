import { PluginSettingTab, Setting, Notice, type App } from "obsidian";
import { translator, type LanguagePreference } from "@project-planner/core/core/i18n";
import type ProjectGanttPlugin from "./main";

export class GanttSettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: ProjectGanttPlugin) { super(app, owner); }
  display(): void {
    const t = translator(this.owner.language);
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName(t("Language"))
      .setDesc(t("Language changes apply immediately. Project files are not changed."))
      .addDropdown(dropdown => {
        dropdown.selectEl.addClass("project-gantt-language");
        dropdown.addOptions({ system: t("System"), en: "English", ru: "Русский" })
        .setValue(this.owner.preference)
        .onChange(async value => {
          dropdown.setDisabled(true);
          try { await this.owner.setLanguage(value as LanguagePreference); }
          catch (error) { new Notice(String(error)); }
          finally { this.display(); }
        });
      });
  }
}
