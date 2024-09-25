import { is } from "@digital-alchemy/core";
import { execa } from "execa";
import { stdout } from "process";

const DEFAULT_WIDTH = 150;
const DEFAULT_HEIGHT = 100;

export function Environment() {
  return {
    async getDimensions() {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      if (is.function(stdout.getWindowSize)) {
        const [width, height] = stdout.getWindowSize();
        return { height, width };
      }
      const lines = await execa("tput", ["lines"]);
      const cols = await execa("tput", ["cols"]);

      const height = is.number(Number(lines.stdout)) ? Number(lines.stdout) : DEFAULT_HEIGHT;
      const width = is.number(Number(cols.stdout)) ? Number(cols.stdout) : DEFAULT_WIDTH;
      return { height, width };
    },
    getHeight() {
      const [, height] = stdout.getWindowSize();
      return height;
    },
    getWidth() {
      const [width] = stdout.getWindowSize();
      return width;
    },
    limitWidth(...widths: number[]): number {
      const [width] = stdout.getWindowSize();
      return Math.min(
        //
        width,
        Math.max(...widths),
      );
    },
  };
}
