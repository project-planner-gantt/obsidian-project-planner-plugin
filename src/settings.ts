import { PluginSettingTab, Setting, Notice, requireApiVersion, type App, type SettingDefinitionRender, type SettingDefinitionItem } from "obsidian";
import { languagePreference, translator } from "@project-planner/core/core/i18n";
import type ProjectGanttPlugin from "./main";
import { editorText } from "./editor-commands";
import type { TaskBooleanSetting } from "./task-settings";

type SettingsRow = Omit<SettingDefinitionRender, "render"> & { render: (setting: Setting) => void };
type SettingsGroup = { type: "group"; heading: string; items: SettingsRow[] };

export class GanttSettingsTab extends PluginSettingTab {
  constructor(app: App, private owner: ProjectGanttPlugin) { super(app, owner); }

  getSettingDefinitions(): SettingDefinitionItem[] { return this.definitions(); }

  /** Fallback for Obsidian 1.8.7–1.12; newer hosts use searchable definitions. */
  display(): void { this.renderLegacy(); }

  private refresh(): void {
    if (requireApiVersion("1.13.0")) this.update();
    else this.renderLegacy();
  }

  private definitions(): (SettingsRow | SettingsGroup)[] {
    const t = translator(this.owner.language);
    const text = (value: Parameters<typeof editorText>[1]) => editorText(this.owner.language, value);
    const toggle = (key: TaskBooleanSetting, label: Parameters<typeof editorText>[1]): SettingsRow => ({
      name: text(label),
      render: setting => {
        setting.addToggle(control => control.setValue(this.owner.editorSettings[key]).onChange(async value => {
          control.setDisabled(true);
          try { await this.owner.saveTaskSettings({ [key]: value }); }
          catch (error) { new Notice(String(error)); }
          finally { this.refresh(); }
        }));
      },
    });
    return [
      {
        name: t("Language"),
        desc: t("Language changes apply immediately. Project files are not changed."),
        render: setting => {
          setting.addDropdown(dropdown => {
            dropdown.selectEl.addClass("project-gantt-language");
            dropdown.addOptions({ system: t("System"), en: "English", ru: "Русский" })
              .setValue(this.owner.preference).onChange(async value => {
                dropdown.setDisabled(true);
                try { await this.owner.setLanguage(languagePreference(value)); }
                catch (error) { new Notice(String(error)); }
                finally { this.refresh(); }
              });
          });
        },
      },
      {
        type: "group", heading: text("New task dates"), items: [
          toggle("isNeedToAddCreatedAtDateOnToday", "Creation date (➕)"),
          toggle("isNeedToAddScheduledDateOnToday", "Scheduled date (⏳)"),
          toggle("isNeedToAddDueDateOnToday", "Due date (📅)"),
        ],
      },
      {
        type: "group", heading: text("New plan task dates"), items: [
          toggle("isNeedToAddCreatedAtDateOnPlanTask", "Creation date (➕)"),
          toggle("isNeedToAddScheduledDateOnPlanTask", "Scheduled date (⏳)"),
          toggle("isNeedToAddDueDateOnPlanTask", "Due date (📅)"),
        ],
      },
      toggle("shiftDatesByWorkingDaysOnly", "Postpone by working days only"),
      {
        name: text("Weekend days"),
        desc: text("Comma-separated: 0 = Sunday, 6 = Saturday. Empty means no weekends."),
        render: setting => {
          setting.addText(control => {
            control.setValue(this.owner.editorSettings.weekendDays.join(", "));
            const save = async () => {
              const input = control.getValue().trim();
              if (input && !/^[0-6](?:\s*,\s*[0-6])*$/.test(input)) {
                control.setValue(this.owner.editorSettings.weekendDays.join(", ")); return;
              }
              try { await this.owner.saveTaskSettings({ weekendDays: input ? input.split(",").map(Number) : [] }); }
              catch (error) { new Notice(String(error)); control.setValue(this.owner.editorSettings.weekendDays.join(", ")); }
            };
            control.inputEl.addEventListener("change", () => { void save(); });
          });
        },
      },
    ];
  }

  private renderLegacy(): void {
    this.containerEl.empty();
    const render = (definition: SettingsRow) => {
      const setting = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) setting.setDesc(definition.desc);
      definition.render(setting);
    };
    for (const definition of this.definitions()) {
      if ("type" in definition) {
        new Setting(this.containerEl).setName(definition.heading ?? "").setHeading();
        for (const item of definition.items) render(item);
      } else render(definition);
    }
  }
}
