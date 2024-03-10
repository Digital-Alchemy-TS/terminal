import { DOWN, is, TServiceParams, UP } from "@digital-alchemy/core";
import { edit } from "external-editor";

import {
  ArrayBuilderOptions,
  ExternalEditorOptions,
  MainMenuEntry,
  MenuComponentOptions,
  ObjectBuilderOptions,
  PickManyComponentOptions,
  PromptAcknowledgeOptions,
  PromptBooleanOptions,
  PromptConfirmOptions,
  PromptPasswordOptions,
  PromptPickOneOptions,
  PromptTimeOptions,
} from "../helpers";
import { ansiEscapes } from "../includes";
import {
  DateEditorEditorOptions,
  NumberEditorRenderOptions,
  StringEditorRenderOptions,
} from ".";

type TypeFilterMenuOptions<VALUE extends unknown = string> = Omit<
  MenuComponentOptions<VALUE | string>,
  "left" | "right" | "leftHeader" | "rightHeader" | "search"
> & {
  header: string;
  entries: MainMenuEntry<VALUE | string>[];
};

export async function Prompts({ terminal, logger, config }: TServiceParams) {
  const { chalk, template } = terminal.internals;

  async function typeFilterMenu<VALUE extends unknown = string>(
    options: TypeFilterMenuOptions<VALUE | string>,
  ): Promise<VALUE | string> {
    let hide = [] as string[];
    const allTypes = is
      .unique(options.entries.map(i => i.type))
      .sort((a, b) => (a > b ? UP : DOWN));

    // eslint-disable-next-line sonarjs/cognitive-complexity
    async function showMenu(): Promise<VALUE | string> {
      const action = await prompts.menu<VALUE | string>({
        ...options,
        keyMap: {
          "[": ["all", { INTERNAL: "all" } as VALUE],
          "]": ["none", { INTERNAL: "none" } as VALUE],
          ...options.keyMap,
        },
        left: options.entries.filter(i => !hide.includes(i.type)),
        leftHeader: options.header || "Options",
        restore: {
          id: "PURGE_MENU",
          type: "value",
          ...options.restore,
        },
        right: allTypes.map(type => ({
          entry: [type, { TOGGLE_TYPE: type } as VALUE],
          icon: terminal.icon.getIcon(
            hide.includes(type) ? "toggle_off" : "toggle_on",
          ),
        })),
        rightHeader: "Types",
        search: {
          right: false,
          type: false,
        },
      });
      if (is.object(action)) {
        if ("INTERNAL" in action && is.string(action.INTERNAL)) {
          if (action.INTERNAL === "all") {
            hide = allTypes;
            return await showMenu();
          }
          if (action.INTERNAL === "none") {
            hide = [];
            return await showMenu();
          }
        }
        if ("TOGGLE_TYPE" in action && is.string(action.TOGGLE_TYPE)) {
          const exists = hide.includes(action.TOGGLE_TYPE);
          hide = exists
            ? hide.filter(i => i !== action.TOGGLE_TYPE)
            : [...hide, action.TOGGLE_TYPE];
          return await showMenu();
        }
      }
      return action;
    }
    return await showMenu();
  }

  const prompts = {
    /**
     * Force a user interaction before continuing
     *
     * Good for giving the user time to read a message before a screen clear happens
     */
    async acknowledge({ label }: PromptAcknowledgeOptions = {}): Promise<void> {
      await terminal.application.activateComponent("acknowledge", {
        label,
      });
    },

    async arrayBuilder<VALUE extends object = object>(
      options: ArrayBuilderOptions<VALUE>,
    ): Promise<VALUE[]> {
      const result = await terminal.application.activateComponent<
        ArrayBuilderOptions<VALUE>,
        VALUE
      >("array", options);
      return result as VALUE[];
    },

    /**
     * prompt for a true / false value
     */
    async boolean({
      label: message,
      current = false,
    }: PromptBooleanOptions): Promise<boolean> {
      return (await prompts.menu({
        condensed: true,
        headerMessage: template(
          `  ${config.terminal.PROMPT_QUESTION} ${message}`,
        ),
        right: [{ entry: ["true", true] }, { entry: ["false", false] }],
        search: { enabled: false },
        value: current,
      })) as boolean;
    },

    /**
     * similar to boolean, but different format for the question to the user
     */
    async confirm({
      label = "Are you sure?",
      current = false,
    }: PromptConfirmOptions = {}): Promise<boolean> {
      return await terminal.application.activateComponent("confirm", {
        current,
        label,
      });
    },

    /**
     * Retrieve a single date from the user.
     *
     * Can be used to retrieve date range also
     */
    async date<T extends Date | { from: Date; to: Date } = Date>({
      current,
      label,
      ...options
    }: DateEditorEditorOptions = {}): Promise<T> {
      const result = await terminal.application.activateEditor<
        DateEditorEditorOptions,
        string
      >("date", {
        current,
        label,
        ...options,
      });
      if (is.array(result)) {
        const [from, to] = result;
        return {
          from: new Date(from),
          to: new Date(to),
        } as T;
      }
      return new Date(result) as T;
    },

    /**
     * Retrieve date range from user
     */
    async dateRange({
      current,
      label,
      ...options
    }: DateEditorEditorOptions = {}): Promise<{ from: Date; to: Date }> {
      const [from, to] = await terminal.application.activateEditor<
        DateEditorEditorOptions,
        string[]
      >("date", {
        current,
        label,
        ...options,
      });
      return { from: new Date(from), to: new Date(to) };
    },

    external({ text, trim = true, ...options }: ExternalEditorOptions): string {
      terminal.screen.rl.output.unmute();
      terminal.screen.printLine(ansiEscapes.cursorShow);
      const out = edit(text, { ...options });
      terminal.screen.printLine(ansiEscapes.cursorHide);
      terminal.screen.rl.output.mute();
      if (!trim) {
        return out;
      }
      return out.trim();
    },

    /**
     * Menus, keyboard shortcuts, and general purpose tool
     *
     * Use the `.cancel` method attached to the promise to close the menu without user interaction
     */
    async menu<VALUE extends unknown = string>(
      options: MenuComponentOptions<VALUE | string>,
    ): Promise<VALUE | string> {
      return await terminal.application.activateComponent("menu", {
        keyMap: {},
        ...options,
      });
    },

    /**
     * Retrieve a number value
     */
    async number(options: NumberEditorRenderOptions = {}): Promise<number> {
      return await terminal.application.activateEditor("number", {
        label: `Number value`,
        ...options,
      } as NumberEditorRenderOptions);
    },

    /**
     * Build a single object inside a table
     */
    async objectBuilder<
      VALUE extends object = object,
      CANCEL extends unknown = never,
    >(options: ObjectBuilderOptions<VALUE, CANCEL>): Promise<VALUE | CANCEL> {
      const result = await terminal.application.activateComponent<
        ObjectBuilderOptions<VALUE, CANCEL>,
        VALUE
      >("object", options);
      return result;
    },

    /**
     * Take in a string value, hiding the individual characters from the screen
     */
    async password({
      label = `Password value`,
      current,
    }: PromptPasswordOptions): Promise<string> {
      return await terminal.application.activateEditor("string", {
        current,
        label,
      } as StringEditorRenderOptions);
    },

    /**
     * Pick many values from a list of options
     */
    async pickMany<T>(options: PickManyComponentOptions<T>): Promise<T[]> {
      const result = await terminal.application.activateComponent<
        PickManyComponentOptions<T>,
        T[]
      >("pick-many", options);
      return result;
    },

    /**
     * Pick a single item out of a list
     */
    async pickOne<T extends unknown = string>({
      options,
      current,
      headerMessage = `Pick one`,
    }: PromptPickOneOptions<T>): Promise<T> {
      if (is.empty(options)) {
        logger.warn(`No choices to pick from`);
        return undefined;
      }
      const cancel = Symbol();
      const result = (await prompts.menu({
        headerMessage: template(`{blue ?} ${headerMessage}`),
        keyMap: { escape: ["Cancel", cancel as T] },
        right: options,
        value: current,
      })) as T;
      if (result === cancel) {
        return current as T;
      }
      return result;
    },

    /**
     * Plain string value
     */
    async string(options: StringEditorRenderOptions = {}): Promise<string> {
      return await terminal.application.activateEditor("string", {
        label: chalk.bold`String value`,
        ...options,
      } as StringEditorRenderOptions);
    },

    /**
     * Retrieve a date object that is used to show time.
     *
     * Day value will be for today
     */
    async time({
      label = `Time value`,
      current = new Date(),
    }: PromptTimeOptions = {}): Promise<Date> {
      return await prompts.date({
        current: current.toISOString(),
        label,
        type: "time",
      });
    },

    typeFilterMenu,
  };

  return prompts;
}
