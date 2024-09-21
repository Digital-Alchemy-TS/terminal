/* eslint-disable unicorn/consistent-function-scoping, @typescript-eslint/no-magic-numbers, @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { is, LABEL, SINGLE, START, VALUE } from "@digital-alchemy/core";
import chalk from "chalk";

import { ansiStrip, ELLIPSES } from "..";
import { PromptEntry } from "../helpers";

const TEMPLATE_REGEX =
  /(?:\\(u(?:[\da-f]{4}|{[\da-f]{1,6}})|x[\da-f]{2}|.))|(?:{(~)?(#?[\w:]+(?:\([^)]*\))?(?:\.#?[\w:]+(?:\([^)]*\))?)*)(?:[\t ]|(?=\r?\n)))|(})|((?:.|[\n\f\r])+?)/gi;
const STYLE_REGEX =
  /(?:^|\.)(?:(?:(\w+)(?:\(([^)]*)\))?)|(?:#(?=[\d:A-Fa-f]{2,})([\dA-Fa-f]{6})?(?::([\dA-Fa-f]{6}))?))/g;
const STRING_REGEX = /^(["'])((?:\\.|(?!\1)[^\\])*)\1$/;
const ESCAPE_REGEX = /\\(u(?:[\da-f]{4}|{[\da-f]{1,6}})|x[\da-f]{2}|.)|([^\\])/gi;

const ESCAPES = new Map([
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["b", "\b"],
  ["f", "\f"],
  ["v", "\v"],
  ["0", "\0"],
  ["\\", "\\"],
  ["e", "\u001B"],
  ["a", "\u0007"],
]);

export async function Internals() {
  function unescape(c) {
    const u = c[0] === "u";
    const bracket = c[1] === "{";

    if ((u && !bracket && c.length === 5) || (c[0] === "x" && c.length === 3)) {
      return String.fromCodePoint(Number.parseInt(c.slice(1), 16));
    }

    if (u && bracket) {
      return String.fromCodePoint(Number.parseInt(c.slice(2, -1), 16));
    }

    return ESCAPES.get(c) || c;
  }

  function parseArguments(name, arguments_) {
    const results = [];
    const chunks = arguments_.trim().split(/\s*,\s*/g);
    let matches;

    for (const chunk of chunks) {
      const number = Number(chunk);
      if (!Number.isNaN(number)) {
        results.push(number);
      } else if ((matches = chunk.match(STRING_REGEX))) {
        results.push(
          matches[2].replaceAll(ESCAPE_REGEX, (_, escape, character) =>
            escape ? unescape(escape) : character,
          ),
        );
      } else {
        throw new Error(`Invalid Chalk template style argument: ${chunk} (in style '${name}')`);
      }
    }

    return results;
  }

  function parseHex(hex) {
    const n = Number.parseInt(hex, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }

  function parseStyle(style) {
    STYLE_REGEX.lastIndex = 0;

    const results = [];
    let matches;

    while ((matches = STYLE_REGEX.exec(style)) !== null) {
      const name = matches[1];

      if (matches[2]) {
        results.push([name, ...parseArguments(name, matches[2])]);
      } else if (matches[3] || matches[4]) {
        if (matches[3]) {
          results.push(["rgb", ...parseHex(matches[3])]);
        }

        if (matches[4]) {
          results.push(["bgRgb", ...parseHex(matches[4])]);
        }
      } else {
        results.push([name]);
      }
    }

    return results;
  }

  function buildStyle(styles) {
    const enabled = {};

    for (const layer of styles) {
      for (const style of layer.styles) {
        enabled[style[0]] = layer.inverse ? null : style.slice(1);
      }
    }

    let current = chalk;
    for (const [styleName, styles] of Object.entries(enabled)) {
      if (!is.array(styles)) {
        continue;
      }

      if (!(styleName in current)) {
        throw new Error(`Unknown Chalk style: ${styleName}`);
      }

      current = styles.length > 0 ? current[styleName](...styles) : current[styleName];
    }

    return current;
  }

  function template(string) {
    const styles = [];
    const chunks = [];
    let chunk = [];

    string.replaceAll(TEMPLATE_REGEX, (_, escapeCharacter, inverse, style, close, character) => {
      if (escapeCharacter) {
        chunk.push(unescape(escapeCharacter));
      } else if (style) {
        const string = chunk.join("");
        chunk = [];
        chunks.push(styles.length === 0 ? string : buildStyle(styles)(string));
        styles.push({ inverse, styles: parseStyle(style) });
      } else if (close) {
        if (styles.length === 0) {
          throw new Error("Found extraneous } in Chalk template literal");
        }

        chunks.push(buildStyle(styles)(chunk.join("")));
        chunk = [];
        styles.pop();
      } else {
        chunk.push(character);
      }
    });

    chunks.push(chunk.join(""));

    if (styles.length > 0) {
      throw new Error(
        `Chalk template literal is missing ${styles.length} closing bracket${
          styles.length === 1 ? "" : "s"
        } (\`}\`)`,
      );
    }

    return chunks.join("");
  }

  function chalkTemplate(firstString: { raw: string[] }, ...arguments_) {
    if (!is.array(firstString) || !is.array(firstString.raw)) {
      // If chalkTemplate() was called by itself or with a string
      throw new TypeError("A tagged template literal must be provided");
    }

    const parts = [firstString.raw[0]];

    for (let index = 1; index < firstString.raw.length; index++) {
      parts.push(
        String(arguments_[index - 1]).replaceAll(/[\\{}]/g, String.raw`\$&`),
        String(firstString.raw[index]),
      );
    }

    return template(parts.join(""));
  }

  function ansiPadEnd(text: string, amount: number, bgColor?: string, char = " "): string {
    const stripped = ansiStrip(text);
    let length = stripped.length;
    if (length > amount) {
      const update = stripped.slice(START, amount - ELLIPSES.length) + ELLIPSES;
      text = text.replace(stripped, update);
      length = update.length;
    }
    let padding = char.repeat(amount - length);
    if (bgColor) {
      padding = chalk.hex(bgColor)(padding);
    }
    return text + padding;
  }

  function GV<T = string>(item: { entry: PromptEntry<T> } | PromptEntry<T>): T {
    if (!is.array(item)) {
      item = item?.entry;
    }
    if (is.empty(item)) {
      return undefined;
    }
    return item.length === SINGLE ? (item[LABEL] as unknown as T) : (item[VALUE] as T);
  }

  return { GV, ansiPadEnd, chalk, chalkTemplate, template };
}
