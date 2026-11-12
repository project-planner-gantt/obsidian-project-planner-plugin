import { PluginSettingTab, Setting, Notice, type App } from "obsidian";
import { translator, type LanguagePreference } from "@project-planner/core/core/i18n";
import type ProjectGanttPlugin from "./main";
import { editorText } from "./editor-commands";
import type { TaskBooleanSetting } from "./task-settings";

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
    const text = (value: Parameters<typeof editorText>[1]) => editorText(this.owner.language, value);
    const toggle = (key: TaskBooleanSetting, name: Parameters<typeof editorText>[1]) => {
      new Setting(this.containerEl).setName(text(name)).addToggle(control => control
        .setValue(this.owner.editorSettings[key])
        .onChange(async value => {
          control.setDisabled(true);
          try { await this.owner.saveTaskSettings({ [key]: value }); }
          catch (error) { new Notice(String(error)); }
          finally { this.display(); }
        }));
    };
    this.containerEl.createEl("h3", { text: text("New task dates") });
    toggle("isNeedToAddCreatedAtDateOnToday", "Creation date (➕)");
    toggle("isNeedToAddScheduledDateOnToday", "Scheduled date (⏳)");
    toggle("isNeedToAddDueDateOnToday", "Due date (📅)");
    this.containerEl.createEl("h3", { text: text("New plan task dates") });
    toggle("isNeedToAddCreatedAtDateOnPlanTask", "Creation date (➕)");
    toggle("isNeedToAddScheduledDateOnPlanTask", "Scheduled date (⏳)");
    toggle("isNeedToAddDueDateOnPlanTask", "Due date (📅)");
    toggle("shiftDatesByWorkingDaysOnly", "Postpone by working days only");
    new Setting(this.containerEl).setName(text("Weekend days"))
      .setDesc(text("Comma-separated: 0 = Sunday, 6 = Saturday. Empty means no weekends."))
      .addText(control => {
        control.setValue(this.owner.editorSettings.weekendDays.join(", "));
        control.inputEl.addEventListener("change", async () => {
          const input = control.getValue().trim();
          if (input && !/^[0-6](?:\s*,\s*[0-6])*$/.test(input)) {
            control.setValue(this.owner.editorSettings.weekendDays.join(", ")); return;
          }
          try { await this.owner.saveTaskSettings({ weekendDays: input ? input.split(",").map(Number) : [] }); }
          catch (error) { new Notice(String(error)); control.setValue(this.owner.editorSettings.weekendDays.join(", ")); }
        });
      });
  }
}
