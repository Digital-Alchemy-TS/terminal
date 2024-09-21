import {
  ARRAY_OFFSET,
  EMPTY,
  INCREMENT,
  INVERT_VALUE,
  is,
  SINGLE,
  START,
  TServiceParams,
} from "@digital-alchemy/core";
import chalk from "chalk";

import { TTYComponentKeymap } from "../../helpers";
import { ansiStrip, ELLIPSES } from "../../includes";

export interface NumberEditorRenderOptions {
  current?: number;
  /**
   * Text that should appear the blue bar of the help text
   */
  helpNotes?: string | ((current: number) => string);
  label?: string;
  locale?: boolean;
  max?: number;
  min?: number;
  placeholder?: string;
  width?: number;
}

const PADDING = 4;
const DEFAULT_PLACEHOLDER = "enter value";
const INTERNAL_PADDING = " ";

export function NumberEditor({ terminal, config }: TServiceParams) {
  const { ansiPadEnd, template } = terminal.internals;
  const KEYMAP: TTYComponentKeymap = new Map([
    [{ catchAll: true, description: "key press", powerUser: true }, onKeyPress],
    [{ description: "done", key: "enter" }, onEnd],
    [{ description: "clear", key: "escape" }, clear],
    [{ description: "reset", key: "f3" }, reset],
    [{ description: "cancel", key: "f4" }, cancel],
    [{ description: "increment", key: "up" }, increment],
    [{ description: "decrement", key: "down" }, decrement],
  ]);

  let complete = false;
  let cursor: number;
  let done: (type: number) => void;
  let opt: NumberEditorRenderOptions;
  let value: string;

  function notes(): string {
    const { helpNotes } = opt;
    if (is.string(helpNotes)) {
      return helpNotes;
    }
    if (is.function(helpNotes)) {
      return helpNotes(Number(this.value));
    }
    return `\n `;
  }

  function cancel(): void {
    reset();
    onEnd();
  }

  function clear(): void {
    value = "";
    editor.render();
  }

  function decrement(): void {
    value = (Number(value) - INCREMENT).toString();
    editor.render();
  }

  function increment(): void {
    value = (Number(value) + INCREMENT).toString();
    editor.render();
  }

  function onEnd() {
    complete = true;
    editor.render();
    done(Number(value));
  }

  function onKeyPress(key: string): void {
    setImmediate(() => editor.render());
    const current = value;
    switch (key) {
      case "left": {
        cursor = cursor <= START ? START : cursor - SINGLE;
        return;
      }
      case "right": {
        cursor = cursor >= value.length ? value.length : cursor + SINGLE;
        return;
      }
      case ".": {
        if (current.includes(".")) {
          return;
        }
        break;
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
        if (cursor === EMPTY) {
          return;
        }
        value = [...value].filter((_, index) => index !== cursor - ARRAY_OFFSET).join("");
        cursor--;
        return;
      }
    }
    if ([...".1234567890"].includes(key)) {
      value = [value.slice(START, cursor), key, value.slice(cursor)].join("");
      cursor++;
    }
  }

  function reset(): void {
    value = (is.number(opt.current) ? opt.current : EMPTY).toString();
    editor.render();
  }

  function renderBox(bgColor: string): void {
    let current = is.empty(value) ? (opt.placeholder ?? DEFAULT_PLACEHOLDER) : value;
    const maxLength = opt.width - PADDING;
    const out: string[] = [];
    if (opt.label) {
      out.push(template(`${config.terminal.PROMPT_QUESTION} ${opt.label}`));
    }

    const stripped = ansiStrip(current);
    let length = stripped.length;
    if (length > maxLength - ELLIPSES.length) {
      const update = ELLIPSES + stripped.slice((maxLength - ELLIPSES.length) * INVERT_VALUE);
      current = current.replace(stripped, update);
      // eslint-disable-next-line sonarjs/no-dead-store
      length = update.length;
    }
    current =
      current === DEFAULT_PLACEHOLDER
        ? current
        : [
            current.slice(START, cursor),
            chalk.inverse(current[cursor] ?? " "),
            current.slice(cursor + SINGLE),
          ].join("");

    out.push(
      // TODO fix this hack
      chalk[bgColor as "red"].black(
        ansiPadEnd(INTERNAL_PADDING + current + INTERNAL_PADDING, maxLength + PADDING),
      ),
    );
    const message = terminal.text.pad(out.join(`\n`));
    terminal.screen.render(
      message,
      terminal.keymap.keymapHelp({
        message,
        notes: notes(),
      }),
    );
  }

  const editor = terminal.registry.registerEditor("number", {
    configure(config: NumberEditorRenderOptions, onDone: (type: unknown) => void) {
      opt = config;
      complete = false;
      reset();
      done = onDone;
      cursor = value.length;
      terminal.keyboard.setKeymap(this, KEYMAP);
    },

    render(): void {
      if (complete) {
        terminal.screen.render(
          template(
            `${config.terminal.PROMPT_QUESTION} {bold ${opt.label}} {gray ${Number(
              value,
            ).toLocaleString()}}`,
          ),
        );
        return;
      }
      if (is.empty(value)) {
        return renderBox(config.terminal.STRING_EDITOR_EMPTY);
      }
      return renderBox(config.terminal.STRING_EDITOR_CONTENT);
    },
  });
}
