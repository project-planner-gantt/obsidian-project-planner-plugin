import { describe, expect, it } from "vitest";
import type { Editor, EditorPosition, EditorTransaction } from "obsidian";
import { runEditorCommand } from "../src/editor-commands";
import { taskSettings } from "../src/task-settings";

function host(text: string, line = 0, ch = text.split("\n")[line].length) {
  const state = { text, anchor: { line, ch }, head: { line, ch }, transactions: [] as EditorTransaction[] };
  const editor = {
    getValue: () => state.text,
    listSelections: () => [{ anchor: state.anchor, head: state.head }],
    transaction: (tx: EditorTransaction) => {
      state.transactions.push(tx);
      for (const change of tx.changes ?? []) {
        const offset = (p: EditorPosition) => state.text.split("\n").slice(0, p.line).reduce((sum, s) => sum + s.length + 1, 0) + p.ch;
        state.text = state.text.slice(0, offset(change.from)) + change.text + state.text.slice(offset(change.to ?? change.from));
      }
      const selection = tx.selections![0];
      state.anchor = selection.from; state.head = selection.to ?? selection.from;
    },
  } as unknown as Editor;
  return { editor, state };
}
const defaults = taskSettings({});
const today = "2026-11-12";
describe("Markdown editor task commands", () => {
  it("creates a task from unsaved text, preserving indentation and the description cursor", () => {
    const { editor, state } = host("# Notes\n\tBuy milk", 1);
    runEditorCommand(editor, "tasks-enhancer-new-task", defaults, today);
    expect(state.text).toBe("# Notes\n\t- [ ] Buy milk ➕ 2026-11-12 ⏳ 2026-11-12 📅 2026-11-12");
    expect(state.head).toEqual({ line: 1, ch: 15 });
    expect(state.transactions).toHaveLength(1);
  });
  it("uses separate date settings for planned tasks and keeps an existing date", () => {
    const { editor, state } = host("- [ ] Plan ⏳ 2026-12-01 ^plan");
    runEditorCommand(editor, "tasks-enhancer-new-plan-task", { ...defaults, isNeedToAddCreatedAtDateOnPlanTask: false, isNeedToAddDueDateOnPlanTask: false }, today);
    expect(state.text).toBe("- [ ] Plan ⏳ 2026-12-01 ^plan");
    expect(state.transactions).toHaveLength(0);
  });
  it("converts a bullet without duplicating the list marker", () => {
    const { editor, state } = host("  - Draft");
    runEditorCommand(editor, "tasks-enhancer-new-task", { ...defaults, isNeedToAddCreatedAtDateOnToday: false, isNeedToAddScheduledDateOnToday: false, isNeedToAddDueDateOnToday: false }, today);
    expect(state.text).toBe("  - [ ] Draft");
  });
  it("does not duplicate an empty checkbox without trailing whitespace", () => {
    const { editor, state } = host("- [ ]");
    runEditorCommand(editor, "tasks-enhancer-new-task", defaults, today);
    expect(state.text).toBe("- [ ] ➕ 2026-11-12 ⏳ 2026-11-12 📅 2026-11-12");
    expect(state.head.ch).toBe(6);
  });
  it.each(["- [x] Done", "- [X] Done", "- [-] Cancelled"])("does not change completed/cancelled tasks: %s", text => {
    const { editor, state } = host(text);
    runEditorCommand(editor, "tasks-enhancer-start-work", defaults, today);
    expect(state.text).toBe(text);
    expect(state.transactions).toHaveLength(0);
  });
  it("postpones over custom weekends without moving the trailing block ID", () => {
    const { editor, state } = host("- [ ] Work 📅 2026-11-13 ^work");
    runEditorCommand(editor, "tasks-enhancer-add-due-date", { ...defaults, shiftDatesByWorkingDaysOnly: true }, today);
    expect(state.text).toBe("- [ ] Work 📅 2026-11-16 ^work");
  });
  it("starts work and stamps creation only once", () => {
    const { editor, state } = host("- [ ] Work ^work");
    for (let i = 0; i < 2; i++) runEditorCommand(editor, "tasks-enhancer-start-work", defaults, today);
    for (let i = 0; i < 2; i++) runEditorCommand(editor, "tasks-enhancer-add-created-date", defaults, today);
    expect(state.text).toBe("- [ ] Work ➕ 2026-11-12 🛫 2026-11-12 ^work");
    expect(state.transactions).toHaveLength(2);
  });
  it("cycles priority while retaining task metadata", () => {
    const { editor, state } = host("- [ ] Work 📅 2026-11-12 ^work");
    runEditorCommand(editor, "tasks-enhancer-cycle-priority", defaults, today);
    runEditorCommand(editor, "tasks-enhancer-cycle-priority", defaults, today);
    expect(state.text).toBe("- [ ] Work ⏫ 📅 2026-11-12 ^work");
  });
  it("moves a block with notes and children and preserves its selection", () => {
    const { editor, state } = host("## Work\n- [ ] First\n- [ ] Second\n  notes\n  - [ ] Child\n## Next", 2, 9);
    state.anchor = { line: 2, ch: 6 };
    runEditorCommand(editor, "tasks-enhancer-move-block-up", defaults, today);
    expect(state.text).toBe("## Work\n- [ ] Second\n  notes\n  - [ ] Child\n- [ ] First\n## Next");
    expect(state.anchor).toEqual({ line: 1, ch: 6 });
    expect(state.head).toEqual({ line: 1, ch: 9 });
    expect(state.transactions).toHaveLength(1);
  });
  it("keeps ordered numbering in its slots and stays within headings", () => {
    const { editor, state } = host("## Work\n1. First\n2. Second\n## Next\n1. Other", 2);
    runEditorCommand(editor, "tasks-enhancer-move-block-up", defaults, today);
    expect(state.text).toBe("## Work\n1. Second\n2. First\n## Next\n1. Other");
    runEditorCommand(editor, "tasks-enhancer-move-block-up", defaults, today);
    expect(state.transactions).toHaveLength(1);
  });
  it("leaves a multi-line selection untouched", () => {
    const { editor, state } = host("First\nSecond");
    state.head = { line: 1, ch: 3 };
    runEditorCommand(editor, "tasks-enhancer-new-task", defaults, today);
    expect(state.transactions).toHaveLength(0);
  });
});
