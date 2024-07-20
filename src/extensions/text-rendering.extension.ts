import {
  ARRAY_OFFSET,
  DOWN,
  EMPTY,
  INCREMENT,
  is,
  LABEL,
  NONE,
  NOT_FOUND,
  ONE_THIRD,
  SINGLE,
  START,
  TServiceParams,
  UP,
} from "@digital-alchemy/core";
import fuzzy from "fuzzysort";
import { stdout } from "process";
import { inspect, InspectOptions } from "util";

import {
  BaseSearchOptions,
  EditableSearchBoxOptions,
  MainMenuEntry,
  MenuDeepSearch,
  MenuHelpText,
  MenuSearchOptions,
} from "../helpers";
import { ansiMaxLength, ELLIPSES } from "../includes";

const MAX_SEARCH_SIZE = 50;
const BUFFER_SIZE = 3;
const MIN_SIZE = 2;
const INDENT = "  ";
const MAX_STRING_LENGTH = 300;
const FIRST = 1;
const BAD_MATCH = -10_000;
const BAD_VALUE = -1000;
const LAST = -1;
const STRING_SHRINK = 100;
// const TEXT_DEBUG = chalk`\n{green.bold ${"=-".repeat(30)}}\n`;
const TEXT_DEBUG = "";
export const INTERNAL_ENTRY = Symbol("INTERNAL_ENTRY");

// ? indexes match keys
// Matching type is important
// Next is label
// Finally help
const MATCH_SCORES = {
  deep: 350,
  helpText: 500,
  label: 250,
  type: 0,
};
type MatchKeys = keyof typeof MATCH_SCORES;

const DEFAULT_PLACEHOLDER = "enter value";

type HighlightResult<T> = Fuzzysort.KeysResult<{
  deep: object;
  helpText: MenuHelpText;
  label: string;
  type: string;
  value: MainMenuEntry<T>;
}>;
const TEXT_CAP = " ";

type SliceRangeOptions = {
  index: number;
  maxLength: number;
  text: string;
};
type SliceTextResult = {
  cursor: number;
  debug: object;
  text: string;
};

/**
 * # Rules
 *
 * Render the box in such a way that newly inserted characters will insert left of the cursor
 * In moving around long strings, the cursor should attempt to stay fixed at the 1/3 point (left side)
 *
 * ## Short strings
 *
 * > lte max length
 *
 * These haven't hit the max size, do not modify.
 * Pad as needed to reach max length
 *
 * ## Long strings
 *
 * > Longer strings that can have the cursor freely moving without being near a text boundary
 *
 * An extra space is appended to the text in order to have a place for the cursor to render at when at the "end".
 * This number is accounted for in the difference between the string length & character indexes
 *
 * ### Cursor at text end
 *
 * ~ render cursor in added blank space (if at end)
 * ~ slice off excess text
 * ~ prefix/append ellipsis
 *
 * ### No nearby text boundary
 *
 * ~ fix the cursor at left 1/3 line
 * ~ prefix & append ellipsis
 * ~ slice text to match max length
 *
 * ### Near boundary
 *
 * Maximum amount of text should be visible
 *
 * ~ (at end) Final 2 characters reveal together: one is the inserted blank space
 * ~ Ellipsis incrementally reveals
 * ~ When all characters are visible, cursor starts moving towards text boundary
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
function sliceRange({
  text,
  index,
  maxLength,
}: SliceRangeOptions): SliceTextResult {
  text += TEXT_CAP;
  const total = text.length;
  const difference = total - maxLength;
  const dotLength = ELLIPSES.length;
  // * Short strings
  if (total <= maxLength) {
    text = text.padEnd(maxLength, " ");
    return {
      cursor: index,
      debug: {
        index,
        maxLength,
        reason: "short string",
        total,
      },
      text,
    };
  }

  const insetLeft = Math.max(Math.floor(maxLength * ONE_THIRD), dotLength);
  const offset = Math.max(index - insetLeft + ARRAY_OFFSET);
  const sliding = total - maxLength + insetLeft - dotLength;
  const modifiedLength = dotLength - TEXT_CAP.length;

  // ? Desired start pattern: 0, 2, 4, 5, 6, 7, 8, 9....
  //  Left side text will appear to jump a bit as ellipses grows
  /* eslint-disable @typescript-eslint/no-magic-numbers */
  const start = offset === 1 ? 2 : offset + 2;

  const pre = ".".repeat(offset === 1 ? 2 : 3);

  // * At end
  if (index === total) {
    text = ELLIPSES + text.slice(total - maxLength + ARRAY_OFFSET) + TEXT_CAP;
    return {
      cursor: maxLength + dotLength - ARRAY_OFFSET,
      debug: {
        index,
        maxLength,
        reason: "at end",
        start: total - maxLength + ARRAY_OFFSET,
        total,
      },
      text,
    };
  }

  // * At start
  // * Near start
  if (index < insetLeft) {
    text = text.slice(START, maxLength) + ELLIPSES;
    return {
      cursor: index,
      debug: {
        index,
        insetLeft,
        maxLength,
        reason: "at / near start",
        total,
      },
      text,
    };
  }

  // * Approaching end
  if (index >= sliding - modifiedLength) {
    const repeat = sliding - index + ARRAY_OFFSET;
    const suffix = repeat > NONE ? ".".repeat(repeat) : "";
    const sLength = suffix.trim().length;
    text = ELLIPSES + text.slice(total - maxLength, total - sLength) + suffix;
    return {
      cursor: index - difference + modifiedLength,
      debug: {
        index,
        maxLength,
        reason: "approaching end",
        total,
      },
      text,
    };
  }
  /* eslint-enable @typescript-eslint/no-magic-numbers */
  // * Middle area
  text = pre + text.slice(start, start + maxLength - pre.length) + ELLIPSES;
  return {
    cursor: insetLeft,
    debug: {
      index,
      maxLength,
      reason: "sliding middle",
      total,
    },
    text,
  };
}

const EXTRA_EARLY = 100;

export function TextRendering({
  terminal,
  config,
  internal,
  lifecycle,
}: TServiceParams) {
  const { chalk, ansiPadEnd, GV, template } = terminal.internals;
  const NESTING_LEVELS = [
    chalk.cyan(" - "),
    chalk.magenta(" * "),
    chalk.green(" # "),
    chalk.yellow(" > "),
    chalk.red(" ~ "),
  ];
  let close: string;
  let open: string;

  lifecycle.onPostConfig(() => {
    const [OPEN, CLOSE] = template(
      `{${config.terminal.FUZZY_HIGHLIGHT} _}`,
    ).split("_");
    open = OPEN;
    close = CLOSE;
  }, EXTRA_EARLY);

  function fuzzyHighlight<T>(
    keys: MatchKeys[],
    result: HighlightResult<T>,
    type: MatchKeys,
  ): string {
    const index = keys.indexOf(type);
    const defaultValue = result.obj[type] as string;
    if (index === NOT_FOUND) {
      return defaultValue;
    }
    const item = is.object(result[index])
      ? result[index]
      : fuzzy.single(defaultValue as string, "");
    const label = fuzzy.highlight(item, open, close);
    return label || defaultValue;
  }

  const rendering = {
    /**
     * # Helper method for component rendering
     *
     * ## Render
     *
     * ~ 2 vertical lists horizontally next to each other
     * ~ Place a dim blue line between them
     * ~ Prepend a search box (if appropriate)
     */
    assemble(
      [leftEntries, rightEntries]: [string[], string[]],
      {
        left,
        right,
        search,
      }: { left?: string; right?: string; search?: string } = {},
    ): string[] {
      const out = [...leftEntries];
      left = left ? " " + left : left;
      const maxA = ansiMaxLength(...leftEntries, left) + ARRAY_OFFSET;
      const maxB = ansiMaxLength(...rightEntries, right);
      const divider = template(config.terminal.MENU_COLUMN_DIVIDER);
      rightEntries.forEach((item, index) => {
        const current = ansiPadEnd(out[index] ?? "", maxA);
        item = ansiPadEnd(item, maxB);
        out[index] = template(`${current}${divider}${item}`);
      });
      if (leftEntries.length > rightEntries.length) {
        out.forEach(
          (line, index) =>
            (out[index] =
              index < rightEntries.length
                ? line
                : ansiPadEnd(line, maxA) + divider),
        );
      }
      if (!is.empty(left)) {
        left = left.padStart(maxA - ARRAY_OFFSET, " ");
        right = right.padEnd(maxB, " ");
        out.unshift(
          template(
            `{blue.bold ${left}} ${config.terminal.MENU_COLUMN_DIVIDER}{blue.bold ${right}}`,
          ),
        );
      }
      if (is.string(search)) {
        out.unshift(...rendering.searchBox(search));
      }
      return out;
    },

    debug(data: object, options: InspectOptions = {}): string {
      const [width] = stdout.getWindowSize();
      return (
        inspect(data, {
          colors: true,
          compact: false,
          depth: config.terminal.TEXT_DEBUG_DEPTH,
          maxArrayLength: config.terminal.TEXT_DEBUG_ARRAY_LENGTH,
          maxStringLength: Math.min(width, STRING_SHRINK),
          sorted: true,
          ...options,
        })
          .split("\n")
          // strip off outer curly braces
          .slice(FIRST, LAST)
          // un-indent single level
          .map(i => (i.startsWith(INDENT) ? i.slice(INDENT.length) : i))
          .join("\n")
      );
    },

    /**
     * Fuzzy sorting for menu entries.
     * More greedy than the basic `fuzzySort`
     *
     * Takes into account helpText and category in addition to label
     */
    fuzzyMenuSort<T extends unknown = string>(
      searchText: string,
      data: MainMenuEntry<T>[],
      options?: MenuSearchOptions<T>,
    ): MainMenuEntry<T>[] {
      const searchEnabled = is.object(options)
        ? (options as BaseSearchOptions).enabled !== false
        : // false is the only allowed boolean
          // undefined = default enabled
          !is.boolean(options);
      if (!searchEnabled || is.empty(searchText)) {
        return data;
      }
      const objectOptions = (options ?? {}) as MenuDeepSearch;
      const deep = objectOptions.deep;

      const formatted = data.map(i => {
        const value = GV(i.entry);
        return {
          deep:
            is.object(value) && is.string(deep)
              ? internal.utils.object.get(value, deep)
              : {},
          helpText: i.helpText,
          label: i.entry[LABEL],
          type: i.type,
          value: i,
        };
      });

      const flags = (is.object(options) ? options : {}) as BaseSearchOptions;
      flags.helpText ??= true;
      flags.label ??= true;
      flags.type ??= true;

      let keys = Object.keys(flags).filter(
        i => flags[i as keyof typeof flags],
      ) as MatchKeys[];
      if (!is.empty(deep)) {
        keys.push("deep");
      }
      if (is.object(options) && options.type === false) {
        keys = keys.filter(i => i !== "type");
      }

      const results = fuzzy.go(searchText, formatted, {
        keys,
        scoreFn: item =>
          Math.max(
            ...keys.map((key, index) =>
              item[index] ? item[index].score - MATCH_SCORES[key] : BAD_VALUE,
            ),
          ),
        threshold: BAD_MATCH,
      });

      // Bad results: those without anything to highlight
      // These will have a score of -1000
      // Not all -1000 score items have nothing to highlight though
      return results
        .filter(data => !data.every(i => i === null))
        .map(result => ({
          entry: [fuzzyHighlight(keys, result, "label"), GV(result.obj.value)],
          helpText: fuzzyHighlight(keys, result, "helpText"),
          type: fuzzyHighlight(keys, result, "type"),
        }));
    },

    /**
     * Take a listing of menu entries, and use fuzzy sort to filter & order results
     */
    fuzzySort<T extends unknown = string>(
      searchText: string,
      data: MainMenuEntry<T>[],
    ): MainMenuEntry<T>[] {
      if (is.empty(searchText)) {
        return data;
      }
      const formatted = data.map(i => ({
        help: i.helpText,
        label: i.entry[LABEL],
        type: i.type,
        value: GV(i.entry),
      }));
      return fuzzy
        .go(searchText, formatted, { all: true, key: "label" })
        .map(result => {
          return {
            entry: [fuzzy.highlight(result, open, close), result.obj.value],
            helpText: result.obj.help,
            type: result.obj.type,
          } as MainMenuEntry<T>;
        });
    },

    helpFormat(helpText: MenuHelpText): string {
      if (is.array(helpText)) {
        helpText = helpText.join(`\n`);
      }
      if (is.object(helpText)) {
        helpText =
          chalk.bold.cyan`Reference Data\n` + terminal.text.type(helpText);
      }
      return helpText;
    },

    mergeHelp(
      message: string,
      { helpText = "" }: { helpText?: MenuHelpText } = {},
    ) {
      if (is.empty(helpText)) {
        return message;
      }
      return (
        message + chalk.blue.dim(`\n \n  ? `) + rendering.helpFormat(helpText)
      );
    },

    /**
     * Take a multiline string, and add an appropriate number of spaces to the beginning of each line
     */
    pad(message: string, amount = MIN_SIZE): string {
      return message
        .split(`\n`)
        .map(i => `${" ".repeat(amount)}${i}`)
        .join(`\n`);
    },

    /**
     * Component rendering
     */
    searchBox(searchText: string, size = MAX_SEARCH_SIZE): string[] {
      const text = is.empty(searchText)
        ? chalk.bgBlue`Type to filter`
        : searchText;
      const color = is.empty(searchText) ? "bgBlue" : "bgWhite";
      return [
        " ",
        template(`{${color}.black  ${ansiPadEnd(text, size)}}`),
        ` `,
      ];
    },

    searchBoxEditable({
      value,
      width,
      bgColor,
      padding = SINGLE,
      cursor: index,
      placeholder = DEFAULT_PLACEHOLDER,
    }: EditableSearchBoxOptions): string[] {
      // * If no value, return back empty box w/ placeholder
      if (!value) {
        return [
          chalk[bgColor as "bold"].black(ansiPadEnd(` ${placeholder} `, width)),
        ];
      }
      const out: string[] = [];

      const { text, cursor, debug } = sliceRange({
        index: index,
        maxLength: width,
        text: value,
      });
      value = [...text]
        .map((i, index) =>
          index === cursor
            ? chalk[bgColor as "bold"].black.inverse(i)
            : chalk[bgColor as "bold"].black(i),
        )
        .join("");

      const pad = chalk[bgColor as "bold"](" ".repeat(padding));
      out.push(ansiPadEnd([pad, value, pad].join(""), width));

      if (!is.empty(TEXT_DEBUG)) {
        out.push(TEXT_DEBUG, rendering.debug(debug), TEXT_DEBUG);
      }
      return out;
    },

    /**
     * Take return a an array slice based on the position of a given value, and PAGE_SIZE.
     */
    selectRange<T>(
      entries: MainMenuEntry<T>[],
      value: unknown,
      extras = false,
    ): MainMenuEntry<T>[] {
      if (entries.length <= config.terminal.PAGE_SIZE) {
        return entries;
      }
      const index = entries.findIndex(i => GV(i) === value);
      if (index <= BUFFER_SIZE) {
        const out = entries.slice(START, config.terminal.PAGE_SIZE);
        const diff = entries.length - out.length;
        if (extras && diff) {
          out.push({
            entry: [template(`{yellow +${diff}} more`), INTERNAL_ENTRY as T],
          });
        }
        return out;
      }
      if (index >= entries.length - config.terminal.PAGE_SIZE + BUFFER_SIZE) {
        const out = entries.slice(entries.length - config.terminal.PAGE_SIZE);
        const diff = entries.length - out.length;
        if (extras && diff) {
          out.unshift({
            entry: [template(`{yellow +${diff}} more`), INTERNAL_ENTRY as T],
          });
        }
        return out;
      }
      const start = index - BUFFER_SIZE;
      const end = config.terminal.PAGE_SIZE + start;
      const out = entries.slice(start, end);

      if (extras) {
        out.unshift({
          entry: [
            template(`{yellow +${index - BUFFER_SIZE}} more`),
            INTERNAL_ENTRY as T,
          ],
        });
        out.push({
          entry: [
            template(`{yellow +${entries.length - end}} more`),
            INTERNAL_ENTRY as T,
          ],
        });
      }
      return out;
    },

    /**
     * Take in a variable of unknown type, return formatted pretty text to print to console
     *
     * Recursively handles objects and arrays.
     */
    // eslint-disable-next-line sonarjs/cognitive-complexity
    type(item: unknown, nested = START, maxLength = MAX_STRING_LENGTH): string {
      if (is.undefined(item)) {
        return chalk.gray(`undefined`);
      }
      if (is.date(item)) {
        return chalk.green(item.toLocaleString());
      }
      if (is.number(item)) {
        return chalk.yellow(Number(item).toLocaleString());
      }
      if (is.boolean(item)) {
        return chalk.magenta(String(item));
      }
      if (is.string(item)) {
        if (is.empty(item)) {
          return chalk.gray(`empty string`);
        }
        let trimmed: string = item;
        if (
          is.number(maxLength) &&
          maxLength > EMPTY &&
          item.length > maxLength
        ) {
          trimmed = (trimmed.slice(START, maxLength - ELLIPSES.length) +
            chalk.blueBright(ELLIPSES)) as string;
        }
        return chalk.blue(trimmed);
      }
      if (is.array(item)) {
        if (is.empty(item)) {
          return chalk.gray(`empty array`);
        }
        return (
          `\n` +
          item
            .map(
              i =>
                INDENT.repeat(nested) +
                NESTING_LEVELS[nested] +
                rendering.type(i, nested + INCREMENT),
            )
            .join(`\n`)
        );
      }
      if (item === null) {
        return chalk.gray(`null`);
      }
      if (is.object(item)) {
        const maxKey =
          Math.max(
            ...Object.keys(item).map(i => internal.utils.TitleCase(i).length),
          ) + INCREMENT;

        const indent = INDENT.repeat(nested);
        const nesting = NESTING_LEVELS[nested];
        const title = (key: string) =>
          internal.utils.TitleCase(key).padEnd(maxKey);
        const type = (key: string) =>
          rendering.type(item[key as keyof typeof item], nested + INCREMENT);

        return (
          (nested ? `\n` : "") +
          Object.keys(item)
            .sort((a, b) => (a > b ? UP : DOWN))
            .map(
              key =>
                indent +
                template(`{bold ${nesting}${title(key)}} `) +
                type(key),
            )
            .join(`\n`)
        );
      }
      return chalk.gray(JSON.stringify(item));
    },
  };

  return rendering;
}
