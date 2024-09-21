import { is, TServiceParams } from "@digital-alchemy/core";

import { PromptAcknowledgeOptions, TTYComponentKeymap } from "../../helpers";
import { ComponentDoneCallback } from "..";

type AcknowledgeConfig = { label: string };

export function AcknowledgeComponent({ terminal, config }: TServiceParams) {
  let done: ComponentDoneCallback;
  const { chalk } = terminal.internals;
  let label: string;
  const KEYMAP = new Map([
    [{ description: "done" }, () => component.onEnd()],
  ]) as TTYComponentKeymap;

  const component = terminal.registry.registerComponent<AcknowledgeConfig>("acknowledge", {
    configure(config, onDone) {
      done = onDone;
      label = config.label;
      terminal.keyboard.setKeymap(component, KEYMAP);
    },
    onEnd() {
      done();
      done = undefined;
    },
    render() {
      if (is.undefined(done)) {
        return;
      }
      terminal.screen.printLine(label || chalk.bold(config.terminal.DEFAULT_ACKNOWLEDGE_MESSAGE));
    },
  });

  return async (options?: string | PromptAcknowledgeOptions) =>
    await terminal.prompt.acknowledge(is.string(options) ? { label: options } : options);
}
