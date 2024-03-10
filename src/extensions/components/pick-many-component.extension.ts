import {
  ARRAY_OFFSET,
  DOWN,
  EMPTY,
  FIRST,
  INCREMENT,
  INVERT_VALUE,
  is,
  LABEL,
  NONE,
  NOT_FOUND,
  SINGLE,
  START,
  TServiceParams,
  UP,
} from "@digital-alchemy/core";

import {
  MainMenuEntry,
  PickManyComponentOptions,
  TTYComponentKeymap,
} from "../../helpers";
import { ansiMaxLength, ansiStrip } from "../../includes";
import { INTERNAL_ENTRY } from "..";

// const UNSORTABLE = new RegExp("[^A-Za-z0-9]", "g");
type MenuSides = "current" | "source";

/**
 * ## Pick many widget
 *
 * Renders 2 lists side by side.
 * One contains a source, one contains a list of selected values.
 */
export function PickMany<VALUE = unknown>({
  terminal,
  internal,
  config,
}: TServiceParams) {
  const { chalk, ansiPadEnd, GV, template } = terminal.internals;
  const EMPTY_LIST = template(` {gray.bold.inverse  List is empty } `);
  const KEYMAP_FIND: TTYComponentKeymap = new Map([
    [
      { description: "backspace", key: "backspace", powerUser: true },
      searchBack,
    ],
    [{ description: "toggle selected", key: ["`", "f4"] }, toggle],
    [{ description: "current", key: "left" }, onLeft],
    [{ description: "toggle find", key: "tab" }, toggleFind],
    [{ description: "available", key: "right" }, onRight],
    [{ description: "searchAppend", powerUser: true }, searchAppend],
    [
      {
        description: "navigate",
        key: ["up", "down", "home", "pageup", "end", "pagedown"],
      },
      navigateSearch,
    ],
  ]);
  const KEYMAP_NORMAL: TTYComponentKeymap = new Map([
    [{ description: "invert", key: "i" }, invert],
    [{ description: "select all", key: ["[", "a"] }, selectAll],
    [{ description: "select none", key: ["]", "n"] }, selectNone],
    [{ description: "toggle find", key: "tab" }, toggleFind],
    [{ description: "toggle selected", key: ["`", "f4", "space"] }, toggle],
    [{ description: "reset", key: "f12" }, reset],
    [{ description: "cancel", key: "escape" }, cancel],
    [{ description: "done", key: "enter" }, () => component.onEnd()],
    [{ description: "left", key: "left" }, onLeft],
    [{ description: "right", key: "right" }, onRight],
    [{ description: "top", key: ["home"] }, top],
    [{ description: "page up", key: ["pageup"] }, pageUp],
    [{ description: "bottom", key: ["end"] }, bottom],
    [{ description: "page down", key: ["pagedown"] }, pageDown],
    [{ description: "previous", key: "up" }, previous],
    [{ description: "next", key: "down" }, next],
    [
      {
        description: "numeric select",
        key: [..."0123456789"],
        powerUser: true,
      },
      numericSelect,
    ],
  ]);

  let value: VALUE;
  let complete = false;
  let current: MainMenuEntry<VALUE | string>[];
  let done: (type: VALUE[]) => void;
  let final = false;
  let mode: "find" | "select" = "select";
  let numericSelection = "";
  let opt: PickManyComponentOptions<VALUE>;
  let searchText = "";
  const lastFilter: Record<MenuSides, MainMenuEntry<VALUE | string>[]> = {
    current: [],
    source: [],
  };
  const sortCache: Record<MenuSides, MainMenuEntry<VALUE | string>[]> = {
    current: [],
    source: [],
  };
  const rawSortCache: Record<MenuSides, MainMenuEntry<VALUE | string>[]> = {
    current: [],
    source: [],
  };
  let selectedType: MenuSides = "source";
  type PrefixItem = {
    prefix: string;
    padded: string;
  };
  let prefixCache: Map<VALUE, PrefixItem>;
  let source: MainMenuEntry<VALUE | string>[];
  let hasGroups: boolean;

  function add(): void {
    setImmediate(() => {
      updateSortCache();
      component.render();
    });
    if (selectedType === "current") {
      return;
    }
    // retrieve source list (prior to removal)
    const raw = side("source", false);
    const sourceList = raw.filter(i => GV(i) !== INTERNAL_ENTRY);

    // Move item to current list
    const item = sourceList.find(
      item => GV(item.entry) === value,
    ) as MainMenuEntry<string>;
    current.push(item);
    // Remove from source
    source = sourceList.filter(check => GV(check.entry) !== value);

    // Find move item in original source list
    const index = sourceList.findIndex(i => GV(i) === value);

    // If at bottom, move up one
    if (index === sourceList.length - ARRAY_OFFSET) {
      // If only item, flip sides
      if (index === START) {
        selectedType = "current";
        return;
      }
      value = GV(sourceList[index - INCREMENT]);
      return;
    }

    // check the entry just below as rendered
    // if it's an internal property, then check the one above
    //
    // the goal of this is to try and keep the cursor with a type group
    // if the user added the last item index in the group, then the cursor would otherwise move to the next group
    // it feels more natural for the cursor to stick with the group
    //
    // if the item is the only item in the group, then the cursor will default to the "move down" logic
    const rawIndex = raw.findIndex(i => GV(i) === value);
    if (
      GV(raw[rawIndex + INCREMENT]) === INTERNAL_ENTRY &&
      GV(raw[rawIndex - INCREMENT]) !== INTERNAL_ENTRY
    ) {
      value = GV(sourceList[index - INCREMENT]);
      return;
    }

    // If not bottom, move down one
    value = GV(sourceList[index + INCREMENT]);
  }

  function bottom(): void {
    const list = rawSortCache[selectedType].filter(
      i => GV(i) !== INTERNAL_ENTRY,
    );
    value = GV(list[list.length - ARRAY_OFFSET]);
    component.render();
  }

  function pageDown(): void {
    const list = rawSortCache[selectedType].filter(
      i => GV(i) !== INTERNAL_ENTRY,
    );
    const index = list.findIndex(i => GV(i) === value);
    const target = Math.min(
      list.length - ARRAY_OFFSET,
      index + config.terminal.PAGE_SIZE,
    );
    value = GV(list[target]);
    component.render();
  }

  function pageUp(): void {
    const list = rawSortCache[selectedType].filter(
      i => GV(i) !== INTERNAL_ENTRY,
    );
    const index = list.findIndex(i => GV(i) === value);
    const target = Math.max(START, index - config.terminal.PAGE_SIZE);
    value = GV(list[target]);
    component.render();
  }

  function cancel(): void {
    reset();
    component.onEnd();
  }

  function invert(): void {
    const temporary = source;
    source = current;
    current = temporary;
    detectSide();
    updateSortCache();
    component.render();
  }

  function navigateSearch(key: string): void {
    setImmediate(() => component.render());
    const all = lastFilter[selectedType];
    if (["pageup", "home"].includes(key)) {
      value = GV(all[START]);
      return;
    }
    if (["pagedown", "end"].includes(key)) {
      value = GV(all[all.length - ARRAY_OFFSET]);
      return;
    }
    const index = all.findIndex(entry => GV(entry) === value);
    if (index === NOT_FOUND) {
      value = GV(all[START]);
      return;
    }
    if (index === START && key === "up") {
      value = GV(all[all.length - ARRAY_OFFSET]);
    } else if (index === all.length - ARRAY_OFFSET && key === "down") {
      value = GV(all[START]);
    } else {
      value = GV(all[key === "up" ? index - INCREMENT : index + INCREMENT]);
    }
  }

  function next(): void {
    setImmediate(() => component.render());
    const list = rawSortCache[selectedType].filter(
      i => GV(i) !== INTERNAL_ENTRY,
    );
    const index = list.findIndex(i => GV(i) === value);
    if (index === NOT_FOUND) {
      value = GV(list[FIRST]);
      return;
    }
    if (index === list.length - ARRAY_OFFSET) {
      // Loop around
      value = GV(list[FIRST]);
      return;
    }
    value = GV(list[index + INCREMENT]);
  }

  function numericSelect(mixed: string): void {
    numericSelection = mixed;
    const item =
      side()[
        Number(is.empty(numericSelection) ? "1" : numericSelection) -
          ARRAY_OFFSET
      ];
    value = is.object(item) ? GV(item) : value;
    component.render();
  }

  function onLeft(): void {
    const [left, right] = [side("current", true), side("source", true)];
    if (is.empty(left) || selectedType === "current") {
      return;
    }
    selectedType = "current";
    let current = right.findIndex(i => GV(i) === value);
    if (current === NOT_FOUND) {
      current = START;
    }
    if (current > left.length) {
      current = left.length - ARRAY_OFFSET;
    }
    value =
      left.length < current
        ? GV(left[left.length - ARRAY_OFFSET])
        : GV(left[current]);
    component.render();
  }

  function onRight(): void {
    const [right, left] = [side("source", true), side("current", true)];
    if (selectedType === "source" || is.empty(right)) {
      return;
    }
    selectedType = "source";
    let current = left.findIndex(i => GV(i) === value);
    if (current === NOT_FOUND) {
      current = START;
    }
    if (current > right.length) {
      current = right.length - ARRAY_OFFSET;
    }
    value =
      right.length - ARRAY_OFFSET < current
        ? GV(right[right.length - ARRAY_OFFSET])
        : GV(right[current]);
    component.render();
  }

  function previous(): void {
    setImmediate(() => component.render());
    const list = rawSortCache[selectedType].filter(
      i => GV(i) !== INTERNAL_ENTRY,
    );
    const index = list.findIndex(i => GV(i) === value);
    if (index === NOT_FOUND) {
      value = GV(list[FIRST]);
      return;
    }
    if (index === FIRST) {
      // Loop around
      value = GV(list[list.length - ARRAY_OFFSET]);
      return;
    }
    value = GV(list[index - INCREMENT]);
  }

  function reset(): void {
    current = [...opt.current];
    source = [...opt.source];
    updateSortCache();
    component.render(true);
  }

  function searchAppend(key: string): void {
    if ((key.length > SINGLE && key !== "space") || ["`"].includes(key)) {
      return;
    }
    searchText += key === "space" ? " " : key;
    if (is.empty(side())) {
      selectedType = selectedType === "source" ? "current" : "source";
    }
    component.render(true);
  }

  function searchBack(): void {
    searchText = searchText.slice(START, ARRAY_OFFSET * INVERT_VALUE);
    component.render(true);
  }

  function selectAll(): void {
    current = [...current, ...source];
    source = [];
    updateSortCache();
    detectSide();
    component.render();
  }

  function selectNone(): void {
    source = [...current, ...source];
    current = [];
    updateSortCache();
    detectSide();
    component.render();
  }

  function toggle(): void {
    if (selectedType === "current") {
      remove();
      updateSortCache();
      component.render();
      return;
    }
    add();
    updateSortCache();
    component.render();
  }

  function updateSortCache() {
    prefixCache = new Map();
    buildSortCache("current");
    buildSortCache("source");
  }

  function toggleFind(): void {
    mode = mode === "find" ? "select" : "find";
    searchText = "";
    terminal.keyboard.setKeymap(
      component,
      mode === "find" ? KEYMAP_FIND : KEYMAP_NORMAL,
    );
    component.render(true);
  }

  function top(): void {
    const list = rawSortCache[selectedType].filter(
      i => GV(i) !== INTERNAL_ENTRY,
    );
    value = GV(list[FIRST]);
    component.render();
  }

  function detectSide(): void {
    const isLeftSide = side("current").some(i => GV(i) === value);
    selectedType = isLeftSide ? "current" : "source";
  }

  function filterMenu(
    side: MenuSides,
    updateValue = false,
  ): MainMenuEntry<VALUE | string>[] {
    const data = side === "source" ? source : current;
    lastFilter[side] = terminal.text.fuzzyMenuSort(searchText, data);
    if (is.empty(lastFilter) || updateValue === false) {
      return terminal.text.selectRange(lastFilter[side], value, true);
    }
    value = GV(lastFilter[side][START]);

    return terminal.text.selectRange(lastFilter[side], value, true);
  }

  function remove(): void {
    if (selectedType === "source") {
      return;
    }
    setImmediate(() => {
      updateSortCache();
      component.render();
    });
    // retrieve current list (prior to removal)
    const raw = side("current", false);
    const currentValue = raw.filter(i => GV(i) !== INTERNAL_ENTRY);

    // Move item to current list
    const item = currentValue.find(
      ({ entry }) => GV(entry) === value,
    ) as MainMenuEntry<string>;
    source.push(item);
    // Remove from source
    current = currentValue.filter(({ entry }) => GV(entry) !== value);

    // Find move item in original source list
    const index = currentValue.findIndex(i => GV(i) === value);

    // If at bottom, move up one
    if (index === currentValue.length - ARRAY_OFFSET) {
      // If only item, flip sides
      if (index === START) {
        selectedType = "current";
        return;
      }
      value = GV(currentValue[index - INCREMENT]);
      return;
    }

    // see add() for commentary on this
    const rawIndex = raw.findIndex(i => GV(i) === value);
    if (
      GV(raw[rawIndex + INCREMENT]) === INTERNAL_ENTRY &&
      GV(raw[rawIndex - INCREMENT]) !== INTERNAL_ENTRY
    ) {
      value = GV(currentValue[index - INCREMENT]);
      return;
    }

    // If not bottom, move down one
    value = GV(currentValue[index + INCREMENT]);
  }

  function renderSide(
    currentSide: MenuSides = selectedType,
    updateValue = false,
  ): string[] {
    const out: string[] = [];
    let menu = side(currentSide, true);
    if (mode === "find" && !is.empty(searchText)) {
      menu = filterMenu(currentSide, updateValue);
    }
    if (is.empty(menu)) {
      out.push(EMPTY_LIST);
    }
    menu.forEach(item => {
      const itemValue = GV(item);
      if (itemValue === INTERNAL_ENTRY || !prefixCache.has(itemValue)) {
        out.push(item.entry[LABEL]);
        return;
      }
      const { padded, prefix } = prefixCache.get(itemValue);

      const highlight = itemValue === value;
      const altColor =
        selectedType === currentSide
          ? config.terminal.MENU_ENTRY_TYPE
          : config.terminal.MENU_ENTRY_TYPE_OTHER;

      const colorPrefix = template(` {${altColor} ${prefix}} `);

      const color =
        selectedType === currentSide
          ? highlight
            ? config.terminal.MENU_ENTRY_SELECTED
            : config.terminal.MENU_ENTRY_NORMAL
          : config.terminal.MENU_ENTRY_OTHER;

      out.push(colorPrefix + template(`{${color}  ${padded}}`));
    });
    return out;
  }

  function buildSortCache(currentSide: MenuSides) {
    const raw = (
      currentSide === "current" ? current : source
    ) as MainMenuEntry<VALUE>[];
    // more of an "advanced sort"
    let sortedList = raw
      .filter(i => GV(i) !== INTERNAL_ENTRY)
      .map(item => [
        item,
        ansiStrip(item.entry[LABEL]).replaceAll(
          new RegExp("[^A-Za-z0-9]", "g"),
          "",
        ),
      ]) as [MainMenuEntry<VALUE | string>, string][];
    // Run through all the menu items, and find the highest priority for each type
    const maxPriority: Record<string, number> = {};
    sortedList.forEach(([{ priority = NONE, type }]) => {
      maxPriority[type] = Math.max(maxPriority[type] ?? NONE, priority);
    });
    // type priority > type alphabetical > item priority > item alphabetical
    sortedList = sortedList.sort(([a, aLabel], [b, bLabel]) => {
      if (a.type === b.type) {
        const aPriority = a.priority ?? EMPTY;
        const bPriority = b.priority ?? EMPTY;
        if (aPriority !== bPriority) {
          return aPriority < bPriority ? UP : DOWN;
        }
        return aLabel > bLabel ? UP : DOWN;
      }
      if (maxPriority[a.type] !== maxPriority[b.type]) {
        return maxPriority[a.type] < maxPriority[b.type] ? UP : DOWN;
      }
      if (a.type > b.type) {
        return UP;
      }
      return DOWN;
    });

    rawSortCache[currentSide] = sortedList.map(
      ([item]) => item as MainMenuEntry<VALUE | string>,
    );
    if (!hasGroups) {
      sortCache[currentSide] = rawSortCache[currentSide];
      return sortCache[currentSide];
    }

    const out = [] as MainMenuEntry<VALUE | string>[];

    const maxType = ansiMaxLength(
      ...sortedList.map(([{ type }]) => type ?? ""),
    );
    const maxLabel =
      ansiMaxLength(
        ...sortedList.map(
          ([{ entry, icon }]) =>
            entry[LABEL] + (is.empty(icon) ? "" : `${icon} `),
        ),
      ) + ARRAY_OFFSET;
    let last = "";
    sortedList.forEach(([item]) => {
      // * Grouping label
      let prefix = ansiPadEnd(item.type ?? "", maxType);
      // ? Optionally, make it fancy
      if (opt.titleTypes) {
        prefix = internal.utils.TitleCase(prefix);
      }
      // ? If it is the same as the previous one (above), then render blank space
      if (last === prefix) {
        prefix = " ".repeat(maxType);
      } else {
        // ? Hand off from one type to another
        // Insert a blank line in between
        // Hope everything is sorted
        if (last !== "" && (mode === "select" || is.empty(searchText))) {
          out.push({ entry: [" ", INTERNAL_ENTRY as VALUE] });
        }
        last = prefix;
        prefix = chalk(prefix);
      }

      // ? Where the cursor is
      const padded = ansiPadEnd(
        // ? If an icon exists, provide it and append a space
        (is.empty(item.icon) ? "" : `${item.icon} `) + item.entry[LABEL],
        maxLabel,
      );
      prefixCache.set(GV(item), { padded, prefix });

      out.push(item);
    });
    sortCache[currentSide] = out;
    return out;
  }

  function side(
    currentSide: MenuSides = selectedType,
    range = false,
  ): MainMenuEntry<VALUE | string>[] {
    if (range) {
      return terminal.text.selectRange(side(currentSide, false), value, true);
    }
    const raw = (
      currentSide === "current" ? current : source
    ) as MainMenuEntry<VALUE>[];
    if (mode === "find") {
      return terminal.text.fuzzyMenuSort<VALUE>(searchText, raw);
    }
    return sortCache[currentSide];
  }

  const component = terminal.registry.registerComponent("pick-many", {
    configure(
      options: PickManyComponentOptions<VALUE>,
      onDone: (type: VALUE[]) => void,
    ): void {
      complete = false;
      final = false;
      done = onDone;
      opt = options;
      opt.source ??= [];
      opt.current ??= [];
      current = [...opt.current];
      source = [...opt.source];
      opt.items ??= `Items`;
      opt.titleTypes ??= true;
      mode = "select";
      hasGroups = [current, source].flat().some(({ type }) => !is.empty(type));
      detectSide();
      updateSortCache();
      const items = side(is.empty(source) ? "current" : "source");
      value ??= GV(items[START]) as VALUE;
      terminal.keyboard.setKeymap(component, KEYMAP_NORMAL);
    },

    onEnd(): void {
      mode = "select";
      final = true;
      component.render();
      done(current.map(i => GV(i.entry) as VALUE));
    },

    render(updateValue = false): void {
      terminal.application.reprintHeader();
      if (complete) {
        return;
      }
      const left = `Current ${opt.items}`;
      const right = `Available ${opt.items}`;
      const current = renderSide(
        "current",
        updateValue && selectedType === "current",
      );
      const source = renderSide(
        "source",
        updateValue && selectedType === "source",
      );
      const search = mode === "find" ? searchText : undefined;
      const message = terminal.text.assemble([current, source], {
        left,
        right,
        search,
      });
      if (final) {
        terminal.screen.render(chalk.blue("=".repeat(ansiMaxLength(message))));
        final = false;
        complete = true;
        return;
      }
      const list = side();
      const item = list.find(i => GV(i) === value);
      terminal.screen.render(
        terminal.text.mergeHelp(message.join(`\n`), item),
        terminal.keymap.keymapHelp({ message: message.join(`\n`) }),
      );
    },
  });

  return async <VALUE extends unknown = unknown>(
    options: PickManyComponentOptions<VALUE>,
  ) => await terminal.prompt.pickMany<VALUE>(options);
}
