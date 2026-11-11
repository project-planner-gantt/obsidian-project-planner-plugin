/** Minimal host double; integration with the real Obsidian UI is a separate check. */
export class TFile {
  constructor(public path: string) {}
}
export class MarkdownView {
  constructor(public file: TFile, public editor: { getValue(): string }) {}
}
