import { TServiceParams } from "@digital-alchemy/core";

import { iBuilderEditor, iComponent } from ".";

export function Registry(i: TServiceParams) {
  const { logger } = i;
  const components = new Map<string, iComponent>();
  const editors = new Map<string, iBuilderEditor>();

  return {
    component: (name: string) => components.get(name),
    editor: (name: string) => editors.get(name),
    registerComponent<
      CONFIG = unknown,
      VALUE = unknown,
      CANCEL extends unknown = never,
    >(
      name: string,
      component: iComponent<CONFIG, VALUE, CANCEL>,
    ): iComponent<CONFIG, VALUE, CANCEL> {
      logger.trace({ name }, `component registered`);
      components.set(name, component as iComponent);
      return component;
    },
    registerEditor<ACTIVE_CONFIG = unknown, VALUE_TYPE = unknown>(
      name: string,
      editor: iBuilderEditor<ACTIVE_CONFIG, VALUE_TYPE>,
    ): iBuilderEditor<ACTIVE_CONFIG, VALUE_TYPE> {
      logger.trace({ name }, `editor registered`);
      editors.set(name, editor as iBuilderEditor);
      return editor;
    },
  };
}
