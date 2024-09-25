import { TServiceParams } from "@digital-alchemy/core";

import { TerminalBuilderEditor, TerminalComponent } from ".";

export function Registry(i: TServiceParams) {
  const { logger } = i;
  const components = new Map<string, TerminalComponent>();
  const editors = new Map<string, TerminalBuilderEditor>();

  return {
    component: (name: string) => components.get(name),
    editor: (name: string) => editors.get(name),
    registerComponent<CONFIG = unknown, VALUE = unknown, CANCEL extends unknown = never>(
      name: string,
      component: TerminalComponent<CONFIG, VALUE, CANCEL>,
    ): TerminalComponent<CONFIG, VALUE, CANCEL> {
      logger.trace({ name }, `component registered`);
      components.set(name, component as TerminalComponent);
      return component;
    },
    registerEditor<ACTIVE_CONFIG = unknown, VALUE_TYPE = unknown>(
      name: string,
      editor: TerminalBuilderEditor<ACTIVE_CONFIG, VALUE_TYPE>,
    ): TerminalBuilderEditor<ACTIVE_CONFIG, VALUE_TYPE> {
      logger.trace({ name }, `editor registered`);
      editors.set(name, editor as TerminalBuilderEditor);
      return editor;
    },
  };
}
