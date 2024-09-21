import {
  ARRAY_OFFSET,
  deepCloneArray,
  deepExtend,
  is,
  SECOND,
  sleep,
  START,
  TServiceParams,
} from "@digital-alchemy/core";

import {
  BuilderCancelOptions,
  DirectCB,
  MainMenuEntry,
  ObjectBuilderMessagePositions,
  ObjectBuilderOptions,
  TableBuilderElement,
  TTYComponentKeymap,
  TTYKeypressOptions,
} from "../../helpers";

type HelpText = {
  helpText: string;
};

const HELP_ERASE_SIZE = 3;
const DEFAULT_MESSAGE_TIMEOUT = 3;
const NORMAL_EXIT = Symbol();

export function ObjectBuilder<
  VALUE extends object = Record<string, unknown>,
  CANCEL extends unknown = never,
>({ terminal, internal }: TServiceParams) {
  const { chalk, GV, template } = terminal.internals;

  const CANCELLABLE: TTYComponentKeymap = new Map([
    [{ description: "cancel", key: "escape" }, cancel],
  ]);
  const FORM_KEYMAP: TTYComponentKeymap = new Map([
    // While there is no editor
    [{ description: "done", key: "x", modifiers: { ctrl: true } }, () => component.onEnd()],
    [{ description: "cursor up", key: "up" }, onUp],
    [{ description: "top", key: ["pageup", "home"], powerUser: true }, onPageUp],
    [{ description: "bottom", key: ["pagedown", "end"], powerUser: true }, onPageDown],
    [{ description: "cursor down", key: "down" }, onDown],
    [{ description: chalk.blue.dim("edit cell"), key: "enter" }, enableEdit],
    [
      {
        description: chalk.blue.dim("reset"),
        key: "r",
        modifiers: { ctrl: true },
      },
      resetField,
    ],
  ] as [TTYKeypressOptions, DirectCB][]);

  /**
   * The current working value
   */
  let value: VALUE;
  /**
   * Stop processing actions, render a static message
   */
  let complete = false;
  /**
   * A message sent by calling code
   */
  let displayMessage: string;
  /**
   * Where to position the message relative to normal rendering
   */
  let displayMessagePosition: ObjectBuilderMessagePositions;
  /**
   * Timeout until the message is removed
   */
  let displayMessageTimeout: ReturnType<typeof sleep>;
  /**
   * Method to call when complete
   */
  let done: (type: VALUE | CANCEL) => void;
  /**
   * Options passed in to configure the current run
   */
  let opt: ObjectBuilderOptions<VALUE, CANCEL>;
  /**
   * Selected row relative to visible elements
   */
  let selectedRow = START;

  function dirtyProperties(): (keyof VALUE)[] {
    const original = opt.current ?? {};
    const current = value;
    return columns()
      .filter(
        ({ path }) =>
          internal.utils.object.get(original, path) !== internal.utils.object.get(current, path),
      )
      .map(({ path }) => path);
  }

  function headerMessage(): string {
    const { headerMessage } = opt;
    if (is.string(headerMessage)) {
      if (headerMessage.endsWith(`\n`)) {
        return headerMessage;
      }
      return headerMessage + `\n`;
    }
    if (is.function(headerMessage)) {
      const out = headerMessage(value);
      if (out.endsWith(`\n`)) {
        return out;
      }
      return out + `\n`;
    }
    return ``;
  }

  function helpNotes(): string {
    const { helpNotes } = opt;
    if (is.string(helpNotes)) {
      return helpNotes;
    }
    if (is.function(helpNotes)) {
      return helpNotes(value);
    }
    return `\n `;
  }

  function columns() {
    return opt.elements;
  }

  function visibleColumns() {
    return columns().filter(i => {
      if (!i.hidden) {
        return true;
      }
      return !i.hidden(value);
    });
  }

  /**
   * available as keyboard shortcut if options.cancel is defined
   *
   * ## Provided as function
   *
   * Call w/ some extra parameters, and bail out early.
   * Calling code can utilize parameters to call an end to this widget at any time, do validation, or present confirmations.
   * It is intended to be async
   *
   * ## Provided as anything else
   *
   * Immediate end, return cancel value
   */
  function cancel(): void {
    const { cancel, current } = opt;
    if (is.function(cancel)) {
      const options: BuilderCancelOptions<VALUE> = {
        cancelFunction: cancelValue => {
          value = cancelValue ?? current;
          end(cancelValue ?? current);
        },
        confirm: async (message = "Discard changes?") => {
          let value: boolean;
          await terminal.screen.footerWrap(async () => {
            value = await terminal.prompt.confirm({ label: message });
          });
          component.render();
          return value;
        },
        current: value,
        dirtyProperties: dirtyProperties(),
        original: current,
        /**
         * - if there is an existing timer, stop it
         * - set the new message position and text
         * - immediate
         */
        sendMessage: async ({
          message,
          timeout = DEFAULT_MESSAGE_TIMEOUT,
          position = "below-bar",
          immediateClear = false,
        }) => {
          if (displayMessageTimeout) {
            displayMessageTimeout.kill("stop");
          }
          displayMessagePosition = position;
          displayMessage = message;
          component.render();
          displayMessageTimeout = sleep(timeout * SECOND);
          await displayMessageTimeout;
          displayMessage = undefined;
          displayMessageTimeout = undefined;
          if (immediateClear) {
            component.render();
          }
        },
      };
      cancel(options);
      return;
    }
    end(cancel);
  }

  /**
   * keyboard event
   */
  async function enableEdit(): Promise<void> {
    await terminal.screen.footerWrap(async () => {
      const column = visibleColumns()[selectedRow];
      const row = value;
      const current = internal.utils.object.get(is.object(row) ? row : {}, column.path);
      let updated: unknown;
      switch (column.type) {
        case "date": {
          updated = await terminal.prompt.date({
            current: current as string,
            label: column.name,
          });
          break;
        }
        case "number": {
          updated = await terminal.prompt.number({
            current: current as number,
            label: column.name,
          });
          break;
        }
        case "boolean": {
          updated = await terminal.prompt.boolean({
            current: !!current,
            label: column.name,
          });
          break;
        }
        case "string": {
          updated = await terminal.prompt.string({
            current: current as string,
            label: column.name,
          });
          break;
        }
        case "pick-many": {
          const currentValue: unknown[] = is.array(current) ? current : [];
          const source = column.options.filter(i => !currentValue.includes(GV(i))) as MainMenuEntry<
            VALUE | string
          >[];
          const selected = column.options.filter(i =>
            currentValue.includes(GV(i)),
          ) as MainMenuEntry<VALUE | string>[];
          updated = await terminal.prompt.pickMany<VALUE>({
            current: selected,
            source,
          });
          break;
        }
        case "pick-one": {
          updated = await terminal.prompt.pickOne({
            current: current,
            headerMessage: column.name,
            options: column.options,
          });
          // TODO: WHY?!
          // The auto erase should catch .. but it doesn't for some reason
          const { helpText } = column.options.find(i => GV(i.entry) === updated);
          if (!is.empty(helpText)) {
            terminal.screen.eraseLine(HELP_ERASE_SIZE);
          }
          break;
        }
      }
      internal.utils.object.set(is.object(row) ? row : {}, column.path, updated);
    });
    component.render();
  }

  /**
   * keyboard event
   */
  function onDown(): void {
    if (selectedRow === visibleColumns().length - ARRAY_OFFSET) {
      onPageUp();
      return;
    }
    selectedRow++;
    component.render();
  }

  /**
   * keyboard event
   */
  function onPageDown(): void {
    selectedRow = visibleColumns().length - ARRAY_OFFSET;
    component.render();
  }

  /**
   * keyboard event
   */
  function onPageUp(): void {
    selectedRow = START;
    component.render();
  }

  /**
   * keyboard event
   */
  function onUp(): void {
    if (selectedRow === START) {
      onPageDown();
      return;
    }
    selectedRow--;
    component.render();
  }

  /**
   * Undo any changes done during the current editing session
   */
  async function resetField(): Promise<void> {
    let value: boolean;
    const field = visibleColumns()[selectedRow];
    const original = internal.utils.object.get(opt.current ?? {}, field.path);
    const current = internal.utils.object.get(value, field.path);
    if (original === current) {
      // nothing to do
      return;
    }
    await terminal.screen.footerWrap(async () => {
      const label = [
        template(
          `Are you sure you want to reset {bold ${field.name}} {cyan (path:} {gray .${field.path}}{cyan )}?`,
        ),
        template(`{cyan.bold Current Value:} ${terminal.text.type(current)}`),
        template(`{cyan.bold Original Value:} ${terminal.text.type(original)}`),
        ``,
      ].join(`\n`);
      value = await terminal.prompt.confirm({ label });
      // FIXME: This shouldn't be necessary
      terminal.screen.eraseLine(label.split(`\n`).length + ARRAY_OFFSET);
    });
    if (!value) {
      return;
    }
    internal.utils.object.set(value, field.path, original);
    component.render();
  }

  /**
   * Terminate editor
   */
  function end(code: unknown): void {
    complete = true;
    component.render();
    if (opt.sanitize === "none" || code !== NORMAL_EXIT) {
      done(is.undefined(code) ? value : (code as VALUE));
      return;
    }
    if (opt.sanitize === "defined-paths") {
      done(
        Object.fromEntries(
          Object.entries(value).filter(([key]) => columns().some(({ path }) => path === key)),
        ) as VALUE,
      );
      return;
    }
    // Only return properties for
    done(
      Object.fromEntries(
        Object.entries(value).filter(([key]) => visibleColumns().some(({ path }) => path === key)),
      ) as VALUE,
    );
  }

  function setDefault(column: TableBuilderElement<VALUE>): void {
    const current = internal.utils.object.get(value, column.path);
    if (!is.undefined(current)) {
      return;
    }
    // It's going to render this option anyways
    // Might as well make it the official default
    if (is.undefined(column.default)) {
      if (column.type === "pick-one") {
        internal.utils.object.set(value, column.path, GV(column.options[START]));
      }
      return;
    }
    let defaultValue: unknown = is.function(column.default)
      ? column.default(value)
      : column.default;
    if (is.function(column.default)) {
      internal.utils.object.set(value, column.path, column.default(value));
      return;
    }
    if (is.array(defaultValue)) {
      defaultValue = deepCloneArray(defaultValue);
    } else if (is.object(defaultValue)) {
      defaultValue = deepExtend({}, defaultValue);
    }
    internal.utils.object.set(value, column.path, defaultValue);
    component.render();
  }

  /**
   * Build up a keymap to match the current conditions
   */
  function setKeymap(): void {
    const maps: TTYComponentKeymap[] = [];
    maps.push(FORM_KEYMAP);
    if (!is.undefined(opt.cancel)) {
      maps.push(CANCELLABLE);
    }
    terminal.keyboard.setKeymap(this, ...maps);
  }

  const component = terminal.registry.registerComponent("object", {
    configure(
      config: ObjectBuilderOptions<VALUE, CANCEL>,
      onDone: (type: VALUE | CANCEL) => void,
    ): void {
      // Reset from last run
      complete = false;
      displayMessage = "";
      opt = config;
      done = onDone;
      selectedRow = START;

      // Build up some defaults on the elements
      config.elements = config.elements.map(i => {
        i.name ??= internal.utils.titleCase(i.path);
        return i;
      });

      // Set up defaults
      config.sanitize ??= "defined-paths";

      // Set up the current value
      value = deepExtend({}, config.current ?? {}) as VALUE;
      columns().forEach(column => setDefault(column));

      setKeymap();
    },

    /**
     * keyboard event
     */
    async onEnd(): Promise<void> {
      const { validate, current } = opt;
      if (is.function(validate)) {
        const result = await validate({
          confirm: async (label = "Are you done?") => {
            let value: boolean;
            await terminal.screen.footerWrap(async () => {
              value = await terminal.prompt.confirm({ label });
            });
            component.render();
            return value;
          },
          current: value,
          dirtyProperties: dirtyProperties(),
          original: current,
          sendMessage: async ({
            message,
            timeout = DEFAULT_MESSAGE_TIMEOUT,
            position = "below-bar",
            immediateClear = false,
            // TODO This shouldn't be a thing
          }) => {
            if (displayMessageTimeout) {
              displayMessageTimeout.kill("stop");
            }
            displayMessagePosition = position;
            displayMessage = message;
            component.render();
            displayMessageTimeout = sleep(timeout * SECOND);
            await displayMessageTimeout;
            displayMessage = undefined;
            displayMessageTimeout = undefined;
            if (immediateClear) {
              component.render();
            }
          },
        });
        if (!result) {
          return;
        }
      }
      end(NORMAL_EXIT);
    },

    render(): void {
      terminal.application.reprintHeader();
      if (complete) {
        terminal.screen.render("", "");
        return;
      }
      const aboveBar =
        displayMessagePosition === "above-bar" && !is.empty(displayMessage)
          ? { helpText: displayMessage }
          : (visibleColumns()[selectedRow] as HelpText);

      const belowBar =
        displayMessagePosition === "below-bar" && !is.empty(displayMessage)
          ? displayMessage
          : helpNotes();

      const message = terminal.text.mergeHelp(
        terminal.text.pad(
          terminal.form.renderForm(
            { ...opt, elements: visibleColumns() },
            value,
            opt.current,
            selectedRow,
          ),
        ),
        aboveBar,
      );

      let header = "";
      if (displayMessagePosition === "header-replace") {
        header = is.empty(displayMessage) ? header : displayMessage;
      } else {
        header = headerMessage();
        if (!is.empty(displayMessage)) {
          if (displayMessagePosition === "header-append") {
            header = header + displayMessage;
          } else if (displayMessagePosition === "header-prepend") {
            header = displayMessage + header;
          }
        }
      }

      terminal.screen.render(
        header + message,
        terminal.keymap.keymapHelp({
          message,
          notes: belowBar,
        }),
      );
    },
  });

  return async <VALUE extends object, CANCEL extends unknown = never>(
    options: ObjectBuilderOptions<VALUE, CANCEL>,
  ) => await terminal.prompt.objectBuilder(options);
}
