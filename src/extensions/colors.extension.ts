import { TServiceParams } from "@digital-alchemy/core";

export type RGB = Record<"r" | "g" | "b", number>;
const OFF = 0;

export function Colors({ terminal }: TServiceParams) {
  return {
    async buildHex(current: string): Promise<string> {
      return await this.prompt.string({
        current,
        label: `Hex Color`,
      });
    },

    async buildRGB(current: RGB): Promise<RGB> {
      return await terminal.prompt.objectBuilder<RGB>({
        current: {
          b: OFF,
          g: OFF,
          r: OFF,
          ...current,
        },
        elements: [
          {
            helpText: "0-255",
            name: "Red",
            path: "r",
            type: "number",
          },
          {
            helpText: "0-255",
            name: "Green",
            path: "g",
            type: "number",
          },
          {
            helpText: "0-255",
            name: "Blue",
            path: "b",
            type: "number",
          },
        ],
      });
    },
  };
}
