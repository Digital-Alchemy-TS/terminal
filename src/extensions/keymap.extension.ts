/* eslint-disable unicorn/consistent-function-scoping */
import { ARRAY_OFFSET, DOWN, is, TServiceParams, UP } from "@digital-alchemy/core";
import chalk from "chalk";

import { HighlightCallbacks, TTYComponentKeymap } from "../helpers";
import { ansiMaxLength } from "../includes";

type keyItem = {
  description: string;
  label: string;
};
const LINE_PADDING = 2;
interface KeymapHelpOptions {
  current?: unknown;
  maxLength?: number;
  /**
   * use maxLength instead
   *
   * @deprecated
   */
  message?: string;
  notes?: string;
  onlyHelp?: boolean;
  prefix?: TTYComponentKeymap;
}

export function KeyMapExtension({ config, terminal }: TServiceParams) {
  const { ansiPadEnd, template } = terminal.internals;

  function buildLines<VALUE extends unknown = unknown>(
    map: TTYComponentKeymap,
    current: VALUE,
  ): keyItem[] {
    return [...map.entries()]
      .filter(([{ powerUser }]) => {
        if (powerUser) {
          return false;
        }
        return true;
      })
      .map(([config, target]): keyItem => {
        const active = Object.entries({ ...config.modifiers })
          .filter(([, state]) => state)
          .map(([name]) => chalk.magenta(name));
        const modifiers = is.empty(active) ? "" : active.join("/") + chalk.cyan("+");
        const list = is.array(config.key)
          ? config.key.map(i => modifiers + i)
          : [modifiers + config.key];

        const activate = config.catchAll
          ? chalk.yellow("default")
          : list.map(i => chalk.yellow.dim(i)).join(chalk.gray(", "));

        let description: string = (config.description ?? target) as string;

        if (config.highlight) {
          const {
            valueMatch = chalk.green.bold,
            normal = chalk.green,
            highlightMatch,
          } = config.highlight as HighlightCallbacks<VALUE>;
          let matched = false;
          if (highlightMatch) {
            const result = highlightMatch(current);
            if (is.function(result)) {
              return {
                description: result(description) as string,
                label: activate,
              };
            }
            matched = result as boolean;
          }
          description = matched ? valueMatch(description) : normal(description);
        } else {
          description = chalk.gray(description);
        }
        return {
          description,
          label: activate,
        };
      })
      .sort((a, b) => (a.label > b.label ? UP : DOWN));
  }

  return {
    keymapHelp({
      current,
      // eslint-disable-next-line sonarjs/deprecation
      message = "",
      maxLength,
      notes = " ",
      prefix = new Map(),
      onlyHelp = false,
    }: KeymapHelpOptions = {}): string {
      const map = terminal.keyboard.getCombinedKeyMap();
      const a = buildLines(prefix, current);
      const b = buildLines(map, current);

      const biggestLabel = ansiMaxLength(
        a.map(i => i.label),
        b.map(i => i.label),
      );
      const help = [...a, ...b]
        .map(({ label, description }) => {
          const paddedLabel = ansiPadEnd(label, biggestLabel);
          return template(`${config.terminal.KEYMAP_TICK}${paddedLabel}  ${description}`);
        })
        .join(`\n`);
      if (onlyHelp) {
        return help;
      }

      // ? Just because content loops, doesn't mean we have to stoop to that level
      maxLength = Math.min(
        // * Use provided max length if available
        maxLength ??
          // * Calculate based on widest known point
          Math.max(
            ansiMaxLength(help.split(`\n`), message.split(`\n`)) + LINE_PADDING,
            // Grab the header length for the bit of extra flair
            terminal.application.headerLength(),
          ),
        terminal.environment.getWidth(),
      );

      if (notes.charAt(notes.length - ARRAY_OFFSET) === "\n") {
        // A trailing newline doesn't render right if it doesn't also include something that actually render
        // Correct for forgetful dev, a blank space works fine
        notes = notes + " ";
      }
      const line = "=".repeat(maxLength);
      return [
        template(`{${config.terminal.HELP_DIVIDER} ${line}}`),
        notes,
        terminal.text.pad(help),
      ].join(`\n`);
    },
  };
}
