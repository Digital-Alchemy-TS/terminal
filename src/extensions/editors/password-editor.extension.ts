import { INVERT_VALUE, is, SINGLE, START, TServiceParams } from "@digital-alchemy/core";

import { KeyModifiers, TTYComponentKeymap } from "../../helpers";

export interface PasswordEditorRenderOptions {
  current: string;
  label?: string;
  placeholder?: string;
  width?: number;
}

export function PasswordEditor({ terminal, config }: TServiceParams) {
  const { template } = terminal.internals;
  const KEYMAP: TTYComponentKeymap = new Map([
    [{ catchAll: true, description: "key press", powerUser: true }, onKeyPress],
    [{ description: "done", key: "enter" }, onEnd],
    [{ description: "reset", key: "escape" }, reset],
    [{ description: "clear", key: "f3" }, clear],
    [{ description: "cancel", key: "f4" }, cancel],
  ]);

  let complete = false;
  let opt: PasswordEditorRenderOptions;
  let done: (type: string) => void;
  let value: string;

  function cancel(): void {
    value = opt.current;
    onEnd();
  }

  function clear(): void {
    value = ``;
    editor.render();
  }

  function onEnd() {
    complete = true;
    editor.render();
    done(value);
  }

  function onKeyPress(key: string, { shift }: KeyModifiers) {
    if (key === "backspace") {
      if (shift) {
        // value = ``;
        return;
      }
      value = value.slice(START, INVERT_VALUE);
      editor.render();
      return;
    }
    if (key === "space") {
      value += " ";
      editor.render();
      return;
    }
    if (key === "tab") {
      return;
    }
    if (key.length > SINGLE) {
      return;
    }
    value += shift ? key.toUpperCase() : key;
    editor.render();
  }

  function reset(): void {
    value = opt.current;
  }

  // FIXME: this
  // eslint-disable-next-line unicorn/consistent-function-scoping
  function renderBox(bgColor: string): void {
    bgColor;
    // let value = is.empty(value)
    //   ? config.placeholder ?? DEFAULT_PLACEHOLDER
    //   : value;
    // const maxLength = config.width - PADDING;
    // const out: string[] = [];
    // if (config.label) {
    //   out.push(chalk`{green ? } ${config.label}`);
    // }
    // const stripped = ansiStrip(value);
    // let length = stripped.length;
    // if (length > maxLength - ELLIPSES.length) {
    //   const update =
    //     ELLIPSES + stripped.slice((maxLength - ELLIPSES.length) * INVERT_VALUE);
    //   value = value.replace(stripped, update);
    //   length = update.length;
    // }
    // out.push(
    //   chalk[bgColor].black(
    //     ansiPadEnd(
    //       INTERNAL_PADDING + value + INTERNAL_PADDING,
    //       maxLength + PADDING,
    //     ),
    //   ),
    // );
    //   const message = textRendering.pad(out.join(`\n`));
    //   screenService.render(
    //     message,
    //     keymap.keymapHelp({
    //       message,
    //     }),
    //   );
  }

  const editor = terminal.registry.registerEditor<PasswordEditorRenderOptions>("password", {
    configure(options, onDone: (type: unknown) => void) {
      opt = options;
      complete = false;
      value = options.current ?? "";
      done = onDone;
      terminal.keyboard.setKeymap(editor, KEYMAP);
    },

    render(): void {
      if (complete) {
        terminal.screen.render(
          template(`${config.terminal.PROMPT_QUESTION} {bold ${opt.label}} {gray ${value}}`),
        );
        return;
      }
      if (is.empty(value)) {
        return renderBox("bgBlue");
      }
      return renderBox("bgWhite");
    },
  });
}
