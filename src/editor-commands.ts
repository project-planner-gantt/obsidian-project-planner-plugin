import { MarkdownView, type Editor, type EditorPosition, type Plugin } from "obsidian";
import { moveTaskBlock } from "@project-planner/core/core/taskBlockMover";
import {
  CREATED_EMOJI, START_EMOJI, SCHEDULED_EMOJI, DUE_EMOJI,
  hasField, getDateField, setDateField, getPriority, setPriority, nextPriority, shiftDate, todayIso,
} from "@project-planner/core/core/taskLineEditor";
import type { TaskSettings } from "./task-settings";
import type { Language } from "@project-planner/core/core/i18n";

const labels = {
  "New task (with dates)": "Создать задачу с датами",
  "New plan task (with dates)": "Создать плановую задачу с датами",
  "Start working on task": "Начать работу над задачей",
  "Add creation date": "Добавить дату создания",
  "Add or postpone scheduled date": "Добавить или перенести запланированную дату",
  "Add or postpone due date": "Добавить или перенести срок завершения",
  "Cycle task priority": "Переключить приоритет задачи",
  "Move task block up": "Переместить блок задачи вверх",
  "Move task block down": "Переместить блок задачи вниз",
  "New task dates": "Даты новой задачи", "New plan task dates": "Даты новой плановой задачи",
  "Creation date (➕)": "Дата создания (➕)", "Scheduled date (⏳)": "Запланированная дата (⏳)",
  "Due date (📅)": "Срок завершения (📅)", "Postpone by working days only": "Переносить только по рабочим дням",
  "Weekend days": "Выходные дни", "Comma-separated: 0 = Sunday, 6 = Saturday. Empty means no weekends.": "Через запятую: 0 — воскресенье, 6 — суббота. Пусто — без выходных.",
} as const;
export function editorText(language: Language, text: keyof typeof labels): string {
  return language === "ru" ? labels[text] : text;
}
export const EDITOR_COMMANDS = [
  ["tasks-enhancer-new-task", "New task (with dates)"],
  ["tasks-enhancer-new-plan-task", "New plan task (with dates)"],
  ["tasks-enhancer-start-work", "Start working on task"],
  ["tasks-enhancer-add-created-date", "Add creation date"],
  ["tasks-enhancer-add-scheduled-date", "Add or postpone scheduled date"],
  ["tasks-enhancer-add-due-date", "Add or postpone due date"],
  ["tasks-enhancer-cycle-priority", "Cycle task priority"],
  ["tasks-enhancer-move-block-up", "Move task block up"],
  ["tasks-enhancer-move-block-down", "Move task block down"],
] as const;
export type EditorCommandId = typeof EDITOR_COMMANDS[number][0];

/** One public Editor transaction, restricted to the changed range. Never writes the Vault. */
function replace(editor: Editor, before: string[], after: string[], anchor: EditorPosition, head: EditorPosition): void {
  let first = 0, last = before.length - 1;
  while (first <= last && before[first] === after[first]) first++;
  if (first > last) return;
  while (last > first && before[last] === after[last]) last--;
  editor.transaction({
    changes: [{ from: { line: first, ch: 0 }, to: { line: last, ch: before[last].length }, text: after.slice(first, last + 1).join("\n") }],
    selections: [{ from: anchor, to: head }],
  }, "project-gantt-task-command");
}

export function runEditorCommand(editor: Editor, id: EditorCommandId, settings: TaskSettings, today = todayIso()): void {
  const selections = editor.listSelections();
  // Commands target one line/block; leave multi-cursor and multi-line selections untouched.
  if (selections.length !== 1) return;
  const { anchor, head } = selections[0];
  if (anchor.line !== head.line) return;
  const before = editor.getValue().split("\n");
  const at = head.line, original = before[at];
  if (original === undefined) return;
  if (id.endsWith("move-block-up") || id.endsWith("move-block-down")) {
    const moved = moveTaskBlock(before, at, id.endsWith("up") ? "up" : "down");
    if (moved) {
      const position = (p: EditorPosition) => ({ line: moved.cursorLine, ch: Math.min(p.ch, moved.lines[moved.cursorLine].length) });
      replace(editor, before, moved.lines, position(anchor), position(head));
    }
    return;
  }
  if (/^[\t ]*[-*+] \[[^ ]\]/.test(original)) return;
  const existing = /^[\t ]*- \[ \](?: |$)/.test(original);
  // Preserve indentation and convert a plain bullet without nesting its marker in the description.
  const indent = /^[\t ]*/.exec(original)![0];
  const body = original.slice(indent.length).replace(/^[-*+] /, "");
  const emptyCheckbox = /^[\t ]*- \[ \]$/.test(original);
  let next = existing ? original + (emptyCheckbox ? " " : "") : `${indent}- [ ] ${body}`;
  const initialPosition = (p: EditorPosition) => ({ ...p, ch: emptyCheckbox && p.ch === original.length ? next.length : existing || p.ch < indent.length ? p.ch : Math.max(indent.length + 6, p.ch + next.length - original.length) });
  let nextAnchor = initialPosition(anchor), nextHead = initialPosition(head);
  const update = (value: string) => {
    let prefix = 0, suffix = 0;
    while (prefix < next.length && prefix < value.length && next[prefix] === value[prefix]) prefix++;
    while (suffix < next.length - prefix && suffix < value.length - prefix && next[next.length - 1 - suffix] === value[value.length - 1 - suffix]) suffix++;
    const position = (p: EditorPosition) => ({ ...p, ch: p.ch <= prefix ? p.ch : p.ch >= next.length - suffix ? p.ch + value.length - next.length : value.length - suffix });
    nextAnchor = position(nextAnchor); nextHead = position(nextHead); next = value;
  };
  const stamp = (emoji: string) => { if (!hasField(next, emoji)) update(setDateField(next, emoji, today)); };
  switch (id) {
    case "tasks-enhancer-new-task":
    case "tasks-enhancer-new-plan-task": {
      const plan = id === "tasks-enhancer-new-plan-task";
      if (plan ? settings.isNeedToAddCreatedAtDateOnPlanTask : settings.isNeedToAddCreatedAtDateOnToday) stamp(CREATED_EMOJI);
      if (plan ? settings.isNeedToAddScheduledDateOnPlanTask : settings.isNeedToAddScheduledDateOnToday) stamp(SCHEDULED_EMOJI);
      if (plan ? settings.isNeedToAddDueDateOnPlanTask : settings.isNeedToAddDueDateOnToday) stamp(DUE_EMOJI);
      break;
    }
    case "tasks-enhancer-start-work": stamp(START_EMOJI); break;
    case "tasks-enhancer-add-created-date": stamp(CREATED_EMOJI); break;
    case "tasks-enhancer-add-scheduled-date":
    case "tasks-enhancer-add-due-date": {
      const emoji = id === "tasks-enhancer-add-scheduled-date" ? SCHEDULED_EMOJI : DUE_EMOJI;
      const current = getDateField(next, emoji);
      update(setDateField(next, emoji, current ? shiftDate(current, 1, settings.shiftDatesByWorkingDaysOnly, settings.weekendDays) : today));
      break;
    }
    case "tasks-enhancer-cycle-priority": update(setPriority(next, nextPriority(getPriority(next)))); break;
  }
  const after = [...before]; after[at] = next;
  replace(editor, before, after, nextAnchor, nextHead);
}

export function registerEditorCommands(plugin: Plugin, language: Language, settings: () => TaskSettings): void {
  for (const [id, name] of EDITOR_COMMANDS) {
    plugin.addCommand({ id, name: editorText(language, name), editorCheckCallback: (checking, editor) => {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      // Obsidian can retain the previous editor while a non-editor view is active.
      if (!(view instanceof MarkdownView) || view.editor !== editor) return false;
      if (!checking) runEditorCommand(editor, id, settings());
      return true;
    } });
  }
}
