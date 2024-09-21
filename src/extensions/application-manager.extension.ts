import { is, START, TServiceParams } from "@digital-alchemy/core";
import chalk from "chalk";
import figlet from "figlet";

import { ansiMaxLength } from "../includes";

export interface TerminalBuilderEditor<ACTIVE_CONFIG = unknown, VALUE_TYPE = unknown> {
  configure: (config: ACTIVE_CONFIG, done: (type: VALUE_TYPE | VALUE_TYPE[]) => void) => void;
  // Just dump it all in there, don't worry about it
  render(): void;
}
export type ComponentDoneCallback<VALUE_TYPE = unknown, CANCEL extends unknown = never> = (
  type?: VALUE_TYPE | VALUE_TYPE[] | CANCEL,
) => void;

export interface TerminalComponent<
  CONFIG = unknown,
  VALUE = unknown,
  CANCEL extends unknown = never,
> {
  value?: VALUE;
  configure(config: CONFIG, onDone: ComponentDoneCallback<VALUE, CANCEL>): void;
  onEnd(abort?: boolean): void;
  render(...data: unknown[]): void;
}

export function ApplicationManager({ config, terminal }: TServiceParams) {
  const { template } = terminal.internals;
  function headerPad(text: string, color: string): string {
    const leftPadding = " ".repeat(config.terminal.APPLICATION_PADDING_LEFT);
    text = template(`{${color} ${text.trim()}}`)
      .split(`\n`)
      .map((i: string) => leftPadding + i)
      .join(`\n`);
    terminal.screen.printLine(text);
    return text;
  }
  let activeEditor: TerminalBuilderEditor;
  let header = "";
  let parts: [primary: string, secondary: string] | [primary: string] = [""];

  const out = {
    /**
     * Start an component instance, and set it as the primary active bit
     */
    async activateComponent<CONFIG, VALUE>(
      name: string,
      configuration: CONFIG = {} as CONFIG,
    ): Promise<VALUE> {
      const oldApplication = out.activeApplication;
      const oldEditor = activeEditor;
      out.activeApplication = undefined;
      activeEditor = undefined;
      const editor = await terminal.keyboard.wrap<VALUE>(
        async () =>
          await new Promise<VALUE>(async done => {
            const component = terminal.registry.component(name);
            if (!component) {
              terminal.screen.printLine(
                // ? It probably wasn't listed in the providers anywhere
                chalk.bgRed.bold.white` Cannot find component {underline ${name}} `,
              );
              return;
            }
            // There needs to be more type work around this
            // It's a disaster
            await component.configure(configuration, value => done(value as VALUE));
            out.activeApplication = component;
            component.render();
          }),
      );
      out.activeApplication = oldApplication;
      activeEditor = oldEditor;
      return editor;
    },

    /**
     * Start an editor instance, and set it as the primary active bit
     */
    async activateEditor<CONFIG, VALUE>(
      name: string,
      configuration: CONFIG = {} as CONFIG,
    ): Promise<VALUE> {
      return await terminal.keyboard.wrap<VALUE>(async () => {
        const component = out.activeApplication;
        out.activeApplication = undefined;
        const promise = new Promise<VALUE>(async done => {
          const editor = terminal.registry.editor(name);
          await editor.configure(configuration, value => done(value as VALUE));
          activeEditor = editor;
          editor.render();
        });
        const result = await promise;
        activeEditor = undefined;
        out.activeApplication = component;
        return result;
      });
    },

    activeApplication: undefined as TerminalComponent,

    /**
     * How wide is the header message at it's widest?
     */
    headerLength(): number {
      return ansiMaxLength(header);
    },

    /**
     * Internal use
     */
    render(): void {
      out.activeApplication?.render();
      activeEditor?.render();
    },

    /**
     * Clear the screen, and re-render the previous header
     */
    reprintHeader(): void {
      terminal.screen.clear();
      const [a, b] = parts;
      out.setHeader(a, b);
    },

    /**
     * Clear the screen, and place a new header message at the top of the screen
     */
    setHeader(primary = "", secondary = ""): number | void {
      parts = [primary, secondary];
      terminal.screen.clear();
      for (let i = START; i < config.terminal.APPLICATION_PADDING_TOP; i++) {
        terminal.screen.printLine();
      }
      if (is.empty(secondary)) {
        secondary = primary;
        primary = "";
      } else {
        primary = headerPad(
          figlet.textSync(primary, {
            font: config.terminal.HEADER_FONT_PRIMARY,
          }),
          config.terminal.HEADER_COLOR_PRIMARY,
        );
      }
      if (is.empty(secondary)) {
        header = primary;
        return;
      }
      if (!is.empty(primary)) {
        terminal.screen.printLine();
      }
      secondary = headerPad(
        figlet.textSync(secondary, {
          font: config.terminal.HEADER_FONT_SECONDARY,
        }),
        config.terminal.HEADER_COLOR_SECONDARY,
      );
      header = `${primary}${secondary}`;
      return ansiMaxLength(header);
    },
  };
  return out;
}
