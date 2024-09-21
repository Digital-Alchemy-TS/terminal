import { TServiceParams } from "@digital-alchemy/core";

import { DirectCB, PromptConfirmOptions, TTYKeypressOptions } from "../../helpers";

export function ConfirmComponent({ terminal }: TServiceParams) {
  let complete = false;
  let done: (state: boolean) => void;
  let initialState = false;
  let label = ``;

  const component = terminal.registry.registerComponent("confirm", {
    configure(
      config: {
        current?: boolean;
        label?: string;
      },
      callback,
    ): void {
      complete = false;
      done = callback;
      label = config.label;
      initialState = config.current;
      terminal.keyboard.setKeymap(
        component,
        new Map<TTYKeypressOptions, DirectCB>([
          [
            { description: "accept", key: "y" },
            () => {
              complete = true;
              done(true);
            },
          ],
          [
            { description: "deny", key: "n" },
            () => {
              complete = true;
              done(false);
            },
          ],
          [
            { description: "default answer", key: "enter" },
            () => {
              complete = true;
              if (initialState) {
                done(true);
                return;
              }
              done(false);
            },
          ],
        ]),
      );
    },

    onEnd(): void {
      complete = true;
    },

    render(): void {
      if (complete) {
        return;
      }
      terminal.screen.render(`${label} (${initialState ? "Y/n" : "y/N"})`);
    },
  });

  return async (options: PromptConfirmOptions) => await terminal.prompt.confirm(options);
}
