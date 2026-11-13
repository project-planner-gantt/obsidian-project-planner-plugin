declare module "@project-planner/core/ui" {
  import type { Component } from "svelte";
  import type { ProjectStore } from "@project-planner/core/core/store";
  import type { Language } from "@project-planner/core/core/i18n";
  import type { GridLayout } from "@project-planner/core/ui/ganttConfig";
  const Planner: Component<{
    store: ProjectStore;
    language?: Language;
    initialLayout?: GridLayout;
    onlayoutchange?: (layout: GridLayout) => void;
  }>;
  export default Planner;
}
declare module "@svar-ui/core-locales" {
  export const ru: Record<string, unknown>;
  export const en: Record<string, unknown>;
}
