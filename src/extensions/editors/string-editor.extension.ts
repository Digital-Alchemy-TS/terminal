import {
  ARRAY_OFFSET,
  EMPTY,
  is,
  SINGLE,
  START,
  TServiceParams,
} from "@digital-alchemy/core";

import { KeyModifiers, TTYComponentKeymap } from "../../helpers";

export type StringEditorRenderOptions = {
  current?: string;
  label?: string;
  mask?: "hide" | "obfuscate";
  // maxLength?: number;
  // minLength?: number;
  padding?: number;
  placeholder?: string;
  // validate?: (value: string) => true | string;
  width?: number;
};

const DEFAULT_PLACEHOLDER = "enter value";
const NO_CURSOR = -1;

export function StringEditor({ terminal, config }: TServiceParams) {
  const { chalk, template } = terminal.internals;

  const KEYMAP: TTYComponentKeymap = new Map([
    [
      { catchAll: true, description: "onKeyPress", powerUser: true },
      onKeyPress,
    ],
    [{ description: "done", key: "enter" }, onEnd],
    [{ description: "reset", key: "r", modifiers: { ctrl: true } }, reset],
    [{ description: "clear", key: "f4" }, clear],
    [{ description: "external", key: "f5" }, external],
    [{ description: "cancel", key: "escape" }, cancel],
  ]);

  let complete = false;
  let opt: StringEditorRenderOptions;
  let cursor: number;
  let done: (type: string) => void;
  let initial: boolean;
  let value: string;

  function cancel(): void {
    value = opt.current;
    onEnd();
  }

  function clear(): void {
    value = "";
    cursor = START;
    editor.render();
  }

  function external() {
    value = terminal.prompt.external({ text: value });
    return onEnd();
  }

  function onEnd() {
    complete = true;
    editor.render();
    done(value);
  }

  function onKeyPress(key: string, { shift }: KeyModifiers) {
    setImmediate(() => editor.render());
    switch (key) {
      case "left": {
        cursor = cursor <= START ? START : cursor - SINGLE;
        return;
      }
      case "right": {
        cursor = cursor >= value.length ? value.length : cursor + SINGLE;
        return;
      }
      case "home": {
        cursor = START;
        return;
      }
      case "end": {
        cursor = value.length;
        return;
      }
      case "delete": {
        value = [...value].filter((_, index) => index !== cursor).join("");
        // no need for cursor adjustments
        return;
      }
      case "backspace": {
        if (shift) {
          return;
        }
        if (cursor === EMPTY) {
          return;
        }
        value = [...value]
          .filter((_, index) => index !== cursor - ARRAY_OFFSET)
          .join("");
        cursor--;
        return;
      }
      case "space": {
        key = " ";
        break;
      }
    }
    if (key.length > SINGLE) {
      return;
    }
    value = [
      value.slice(START, cursor),
      shift ? key.toUpperCase() : key,
      value.slice(cursor),
    ].join("");
    cursor++;
  }

  function reset(): void {
    value = opt.current ?? "";
    cursor = value.length;
    editor.render();
  }

  function renderBox(bgColor: string, cursorValue = cursor): void {
    const placeholder = opt.placeholder ?? DEFAULT_PLACEHOLDER;
    let current = is.empty(value) ? placeholder : value;
    if (current !== DEFAULT_PLACEHOLDER) {
      if (opt.mask === "hide") {
        current = "";
      } else if (opt.mask === "obfuscate") {
        current = "*".repeat(current.length);
      }
    }
    const out: string[] = [];
    if (opt.label) {
      out.push(template(`${config.terminal.PROMPT_QUESTION} ${opt.label}`));
    }
    out.push(
      ...terminal.text.searchBoxEditable({
        bgColor,
        cursor: cursorValue,
        padding: opt.padding,
        value: current,
        width: opt.width,
      }),
    );
    const message = terminal.text.pad(out.join(`\n`));
    terminal.screen.render(
      message,
      terminal.keymap.keymapHelp({
        message,
      }),
    );
  }

  const editor = terminal.registry.registerEditor("string", {
    configure(
      options: StringEditorRenderOptions,
      onDone: (type: unknown) => void,
    ) {
      options.width ??= config.terminal.DEFAULT_PROMPT_WIDTH;
      opt = options;
      complete = false;
      initial = true;
      value = options.current ?? "";
      done = onDone;
      terminal.keyboard.setKeymap(this, KEYMAP);
      cursor = value.length;
    },

    render(): void {
      if (initial) {
        initial = false;
        if (value.includes(`\n`)) {
          external();
          return;
        }
      }
      if (complete) {
        terminal.screen.render(
          template(`${config.terminal.PROMPT_QUESTION} {bold ${opt.label}}\n`) +
            chalk.gray(value),
        );
        return;
      }
      if (is.empty(value)) {
        return renderBox(config.terminal.STRING_EDITOR_EMPTY, NO_CURSOR);
      }
      return renderBox(config.terminal.STRING_EDITOR_CONTENT);
    },
  });

  return async (options: StringEditorRenderOptions) =>
    await terminal.prompt.string(options);
}
