import { each, is, TServiceParams } from "@digital-alchemy/core";
import chalk from "chalk";

import { DirectCB, KeyDescriptor, KeyModifiers, TTYComponentKeymap } from "../helpers";

export function KeyboardManager({ terminal, lifecycle }: TServiceParams) {
  let activeKeymaps: Map<unknown, TTYComponentKeymap> = new Map();

  lifecycle.onPreInit(() => {
    const rl = terminal.screen.rl;
    rl.input.on("keypress", (value, key = {}) => {
      keyPressHandler({ key, value });
    });
  });

  async function keyPressHandler(descriptor: KeyDescriptor): Promise<void> {
    if (is.empty(activeKeymaps)) {
      return;
    }
    const { key } = descriptor;
    const { ctrl, meta, shift, name, sequence } = key ?? {};
    let mixed = name ?? sequence ?? "enter";
    // Standardize the "done" key
    mixed = mixed === "return" ? "enter" : mixed;
    const catchAll: [unknown, DirectCB][] = [];
    const direct: [unknown, DirectCB][] = [];
    const modifiers: KeyModifiers = { ctrl, meta, shift };

    // Build list of callbacks based on key
    activeKeymaps.forEach((map, target) => {
      map.forEach((callback, options) => {
        if (is.undefined(options.key)) {
          catchAll.push([target, callback]);
          return;
        }
        const keys = [options.key].flat();
        if (!keys.includes(mixed)) {
          return;
        }
        const allMatch = Object.entries(options.modifiers ?? {}).every(
          ([modifier, value]) => modifiers[modifier as keyof typeof modifiers] === value,
        );
        if (!allMatch) {
          return;
        }
        direct.push([target, callback]);
      });
    });
    // If there are any that directly look for this combination, then only use those
    // Otherwise, use all the catchall callbacks
    const list = is.empty(direct) ? catchAll : direct;
    // Do not re-render if no listeners are present at all
    // const render = !is.empty(list);
    await each(list, async ([, key]) => {
      await key(mixed, modifiers);
    });
  }

  const manager = {
    focus<T>(target: unknown, map: TTYComponentKeymap, value: Promise<T>): Promise<T> {
      return new Promise(async done => {
        const currentMap = activeKeymaps;
        activeKeymaps = new Map([[target, map]]);
        const out = await value;
        activeKeymaps = currentMap;
        done(out);
      });
    },

    getCombinedKeyMap(): TTYComponentKeymap {
      const map: TTYComponentKeymap = new Map();
      activeKeymaps.forEach(sub => sub.forEach((a, b) => map.set(b, a)));
      return map;
    },
    load(item: Map<unknown, TTYComponentKeymap>): void {
      activeKeymaps = item;
    },

    save(): Map<unknown, TTYComponentKeymap> {
      const current = activeKeymaps;
      activeKeymaps = new Map();
      return current;
    },

    setKeymap(target: unknown, ...mapList: TTYComponentKeymap[]): void {
      const result: TTYComponentKeymap = new Map();
      mapList.forEach(keMap =>
        keMap.forEach((callback, options) => {
          result.set(options, callback);
        }),
      );
      activeKeymaps.set(target, result);
      result.forEach(key => {
        if (is.string(key) && !is.function(target[key as keyof typeof target])) {
          terminal.screen.printLine(chalk.yellow.inverse` MISSING CALLBACK {bold ${key}} `);
        }
      });
    },

    /**
     * Implies ApplicationManager#wrap()
     */
    async wrap<T>(callback: () => Promise<T>): Promise<T> {
      const application = terminal.application.activeApplication;
      const map = manager.save();
      const result = await callback();
      manager.load(map);
      terminal.application.activeApplication = application;
      return result;
    },
  };

  return manager;
}
