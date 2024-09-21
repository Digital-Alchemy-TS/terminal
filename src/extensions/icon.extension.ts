import { TServiceParams } from "@digital-alchemy/core";

import { FontAwesomeIcons } from "../icons";

export enum TTYReplacementIcons {
  toggle_on = "toggle_on",
  toggle_off = "toggle_off",
}

export function IconExtension({ terminal, config }: TServiceParams) {
  const { chalk } = terminal.internals;
  const IconMap = new Map<TTYReplacementIcons, string[]>([
    [TTYReplacementIcons.toggle_on, [FontAwesomeIcons.toggle_on, "*"].map(i => chalk.green(i))],
    [TTYReplacementIcons.toggle_off, [FontAwesomeIcons.toggle_off, "*"].map(i => chalk.red(i))],
  ]);

  return {
    getIcon(name: `${TTYReplacementIcons}`): string {
      const [icon, normal] = IconMap.get(name as TTYReplacementIcons);
      return config.terminal.USE_FONTAWESOME_ICONS ? icon : normal;
    },
  };
}
