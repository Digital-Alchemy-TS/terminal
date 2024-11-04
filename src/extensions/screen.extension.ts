/* eslint-disable no-console */
import {
  EMPTY,
  INCREMENT,
  is,
  LABEL,
  NONE,
  SINGLE,
  START,
  TServiceParams,
  VALUE,
} from "@digital-alchemy/core";
import { ResultPromise } from "execa";
import MuteStream from "mute-stream";
import { stdin, stdout } from "process";
import { createInterface, Interface } from "readline";
import { ReadStream } from "tty";

import { ansiEscapes, ansiMaxLength } from "../includes";

const PADDING = 2;
const calc_height = (content: string) => content.split("\n").length + PADDING;

const output = new MuteStream();
output.pipe(stdout);

/**
 * 🧙 Perform some witchcraft to chunk up lines that are too long
 */
function breakLines(content: string, width: number): string {
  const regex = new RegExp(`(?:(?:\\033[[0-9;]*m)*.?){1,${width}}`, "g");
  return content
    .split("\n")
    .flatMap(line => {
      // eslint-disable-next-line sonarjs/sonar-prefer-regexp-exec
      const chunk = line.match(regex);
      chunk?.pop();
      return chunk || "";
    })
    .join("\n");
}

export async function Screen({ terminal, config }: TServiceParams) {
  const { template } = terminal.internals;
  let height = EMPTY;
  let lastContent: [string, string[]];
  let sticky: [string, string[]];

  // protected onModuleDestroy(): void {
  //   done();
  // }

  // protected onModuleInit(): void {
  //   out.printLine(ansiEscapes.cursorHide);
  // }

  // private clean(extraLines) {
  //   if (extraLines > EMPTY) {
  //     down(extraLines);
  //   }
  //   eraseLine(height);
  // }

  const out = {
    clear(): void {
      height = EMPTY;
      lastContent = undefined;
      out.rl.output.unmute();
      // Reset draw to top
      out.rl.output.write("\u001B[0f");
      // Clear screen
      out.rl.output.write("\u001B[2J");
      out.rl.output.mute();
    },
    cursorLeft(amount = SINGLE): void {
      out.printLine(ansiEscapes.cursorBackward(amount));
    },

    cursorRight(amount = SINGLE): void {
      out.printLine(ansiEscapes.cursorForward(amount));
    },

    /**
     * A shotgun attempt at returning the terminal to a normal state
     */
    done() {
      out.rl.output.unmute();
      out.rl.setPrompt("");
      console.log(ansiEscapes.cursorShow);
    },

    /**
     * Move the rendering cursor down 1 row
     */
    down(amount = SINGLE): void {
      out.rl.output.unmute();
      if (amount === SINGLE) {
        out.printLine();
        return;
      }
      out.printLine(ansiEscapes.cursorDown(amount));
      out.rl.output.mute();
    },

    /**
     * Delete line(s) and move cursor up
     */
    eraseLine(amount = SINGLE): void {
      out.printLine(ansiEscapes.eraseLines(amount));
    },

    /**
     * - Capture the current render content as static content
     * - Deactivate current keyboard shortcuts
     * - Nest a new rendering session underneath the current
     * - DOES NOT DO MULTIPLE LEVELS!
     *
     * Intended use case is a dual editor situation. Ex:
     *
     * - Editable table cells where the table remains visible
     *
     * ----
     *
     * - Implies KeyboardManger#wrap()
     * - Implies ApplicationManager#wrap()
     */
    async footerWrap<T>(callback: () => Promise<T>): Promise<T> {
      sticky = lastContent;
      return await terminal.keyboard.wrap(async () => {
        out.render();
        const result = await callback();
        out.printLine(ansiEscapes.eraseLines(calc_height(sticky[START]) + PADDING));
        sticky = undefined;
        height = PADDING;
        // Next-render up to the calling service
        // The sticky content is stale now 🤷
        return result;
      });
    },

    async pipe(child: ResultPromise): Promise<void> {
      out.rl.output.unmute();
      child.stdout.pipe(stdout);
      out.rl.output.mute();
      await child;
    },

    print(text: string): void {
      out.rl.output.unmute();
      out.rl.output.write(text);
      out.rl.output.mute();
    },

    /**
     * console.log, with less options
     */
    printLine(line: unknown = ""): void {
      out.rl.output.unmute();
      console.log(line);
      // Muting prevents user interactions from presenting to the screen directly
      // Must rely on application rendering to display keypresses
      out.rl.output.mute();
    },

    /**
     * Print content to the screen, maintaining an internal log of what happened
     * so that the content can be redrawn in place clearing out the previous render.
     */
    async render(content?: string, ...extra: string[]): Promise<void> {
      if (
        !is.empty(lastContent) &&
        lastContent[LABEL] === content &&
        lastContent[VALUE].every((item, index) => extra[index] === item)
      ) {
        return;
      }
      lastContent = [content, extra];

      // footerWrap means new content is rendered below previous
      let stickyContent = "";
      if (sticky) {
        const header = sticky[START];
        const line = "=".repeat(
          terminal.environment.limitWidth(
            ansiMaxLength(header, content ?? ""),
            terminal.application.headerLength(),
          ),
        );
        stickyContent =
          header + `\n` + template(`{${config.terminal.HELP_DIVIDER} ${line}}`) + `\n`;
      }

      if (is.empty(content)) {
        out.printLine(ansiEscapes.eraseLines(height) + stickyContent);
        height = NONE;
        return;
      }

      const { width: maxWidth } = await terminal.environment.getDimensions();
      content = breakLines(content, maxWidth);

      // Intended for supplemental content
      // keyboard shortcut listings and such
      let bottomContent = is.empty(extra) ? `` : extra.join(`\n`);
      if (!is.empty(bottomContent)) {
        bottomContent = breakLines(bottomContent, maxWidth);
      }

      const fullContent = content + (bottomContent ? "\n" + bottomContent : "");

      out.printLine(ansiEscapes.eraseLines(height) + fullContent);
      // Increment to account for `eraseLines` being output at the same time as the new content
      height = calc_height(fullContent) - INCREMENT;
    },

    rl: createInterface({
      input: stdin,
      output,
      terminal: true,
    }) as Interface & { input: ReadStream; output: MuteStream },

    /**
     * Move the rendering cursor up 1 line
     */
    up(amount = SINGLE): void {
      out.printLine(ansiEscapes.cursorUp(amount));
    },
  };

  return out;
}
