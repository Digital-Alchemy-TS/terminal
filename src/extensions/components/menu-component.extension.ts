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
  PAIR,
  SINGLE,
  START,
  TServiceParams,
  UP,
  VALUE,
} from "@digital-alchemy/core";
import dayjs from "dayjs";

import {
  AdvancedKeymap,
  BaseSearchOptions,
  DirectCB,
  HighlightCallbacks,
  KeyMap,
  KeymapOptions,
  KeyModifiers,
  MainMenuEntry,
  MenuComponentOptions,
  MenuPosition,
  MenuRestore,
  MenuSearchOptions,
  TTYKeypressOptions,
} from "../../helpers";
import { ansiMaxLength, ansiStrip } from "../../includes";

type tMenuItem = [TTYKeypressOptions, DirectCB];
type PrefixArray = [TTYKeypressOptions, DirectCB];

function isAdvanced<VALUE = string>(
  options: KeymapOptions<VALUE>,
): options is AdvancedKeymap<VALUE> {
  return is.object(options);
}

type MenuRestoreCacheData<VALUE = unknown> = {
  position: MenuPosition;
  value: VALUE;
};
const DEFAULT_HEADER_PADDING = 4;

const CACHE_KEY_RESTORE = (id: string) => `MENU_COMPONENT_RESTORE_${id}`;

interface LastMenuResultInfo<VALUE = unknown> {
  key?: {
    key: string;
    modifiers: KeyModifiers;
  };
  key_entry?: KeymapOptions<VALUE> | AdvancedKeymap;
  returned: VALUE;
  selected_entry: {
    entry: MainMenuEntry<VALUE>;
    index: number;
    side: "left" | "right";
  };
  type: "entry" | "keyboard";
}

type MenuProperties =
  | "alert"
  | "body"
  | "columnHeaders"
  | "header"
  | "divider"
  | "helpText"
  | "keybindings"
  | "notes";

const CONSTRUCTION_ORDER: MenuProperties[] = [
  "alert",
  "header",
  "columnHeaders",
  "body",
  "helpText",
  "divider",
  "notes",
  "keybindings",
];

const PRIORITY_ORDER: MenuProperties[] = [
  "body",
  "columnHeaders",
  "alert",
  "helpText",
  "header",
  "divider",
  "keybindings",
  "notes",
];
const FIND_INPUT = "find-input";

type ConstructionItem = {
  height: number;
  text: string;
  width: number;
};

type MenuConstruction = Partial<Record<MenuProperties, ConstructionItem>>;
const BLANK_SPACE = Symbol();

/**
 * FIXME: This is currently a "best faith" attempt at row calculation.
 * It ignores that text can roll over the side, and create an extra row, which would not be seen here
 */
const CONSTRUCTION_PROP = (text: string): ConstructionItem => ({
  height: text.split(`\n`).length,
  text,
  width: ansiMaxLength(text),
});

type MenuModes = "find-navigate" | "select" | "find-input";

function isSearchEnabled(options: MenuSearchOptions) {
  return is.object(options)
    ? (options as BaseSearchOptions).enabled !== false
    : // false is the only allowed boolean
      // undefined = default enabled
      !is.boolean(options);
}

let LAST_RESULT: LastMenuResultInfo<unknown>;
type LR = "left" | "right";

export function Menu<VALUE = unknown>({ config, terminal, internal, cache }: TServiceParams) {
  const { chalk, ansiPadEnd, template, GV } = terminal.internals;

  let value: VALUE;
  let callbackOutput = "";
  let callbackTimestamp = dayjs();
  let complete = false;
  let done: (type: VALUE) => void;
  let final = false;
  let headerPadding: number;
  let leftHeader: string;
  let mode: MenuModes = "select";
  let opt: MenuComponentOptions<VALUE>;
  let rightHeader: string;
  let searchCursor: number;
  let searchEnabled: boolean;
  let searchEnabledLeft: boolean;
  let searchEnabledRight: boolean;
  let searchText = "";
  let selectedType: LR = "right";
  let selectedValue: VALUE;
  let sort: boolean;
  const searchCache = {
    current: undefined as Record<LR, MainMenuEntry<VALUE>[]>,
    old: undefined as Record<LR, MainMenuEntry<VALUE>[]>,
  };

  function notes(): string {
    const { helpNotes } = opt;
    if (is.string(helpNotes)) {
      return helpNotes;
    }
    if (is.array(helpNotes)) {
      return helpNotes.join(`\n`);
    }
    if (is.function(helpNotes)) {
      return helpNotes(value);
    }
    return `\n `;
  }

  /**
   * Run callbacks from the keyMap
   */
  async function activateKeyMap(mixed: string, modifiers: KeyModifiers): Promise<void> {
    const { keyMap, keyMapCallback: callback } = opt;
    const entry = findKeyEntry(keyMap, mixed);
    if (!entry) {
      return;
    }
    if (is.undefined(callback)) {
      selectedValue = value;
      value = GV(entry);
      LAST_RESULT = {
        key: {
          key: mixed,
          modifiers,
        },
        key_entry: entry,
        returned: value,
        selected_entry: undefined,
        type: "keyboard",
      } as LastMenuResultInfo;
      component.onEnd();
      return;
    }
    const selectedItem = side(selectedType).find(({ entry }) => GV(entry) === value);
    const result = await (selectedItem
      ? callback(GV(entry) as string, [
          // Force a value entry to be present
          selectedItem.entry[LABEL],
          GV(selectedItem),
        ])
      : callback(GV(entry) as string, [undefined, undefined]));
    if (is.string(result)) {
      callbackOutput = result;
      callbackTimestamp = dayjs();
      return;
    }
    if (result) {
      selectedValue = value;
      value = GV(entry);
      LAST_RESULT = {
        key: {
          key: mixed,
          modifiers,
        },
        key_entry: entry,
        returned: value,
        selected_entry: undefined,
        type: "keyboard",
      } as LastMenuResultInfo;
      component.onEnd();
    }
  }

  /**
   * Move the cursor to the bottom of the list
   */
  function bottom(): void {
    const list = side(selectedType);
    value = GV(list[list.length - ARRAY_OFFSET].entry);
    component.render(false);
  }

  /**
   * Move the cursor around
   *
   * mode: "select"
   */
  function navigateSearch(key: string): void {
    // * Grab list of items from current side
    const all = side(selectedType);
    let available = filterMenu(all, selectedType);
    if (is.empty(available)) {
      available = all;
    }
    if (["pageup", "home"].includes(key)) {
      value = GV(available[START].entry);
      return;
    }
    if (["pagedown", "end"].includes(key)) {
      value = GV(available[available.length - ARRAY_OFFSET].entry);
      return;
    }
    const index = available.findIndex(({ entry }) => GV(entry) === value);
    if (index === NOT_FOUND) {
      value = GV(available[START].entry);
      return;
    }
    if (index === START && key === "up") {
      value = GV(available[available.length - ARRAY_OFFSET].entry);
      return;
    }
    if (index === available.length - ARRAY_OFFSET && key === "down") {
      value = GV(available[START].entry);
      return;
    }
    value = GV(available[key === "up" ? index - INCREMENT : index + INCREMENT].entry);
  }

  /**
   * Move down 1 entry
   */
  function next(): void {
    setImmediate(() => component.render(false));
    const list = side(selectedType);
    const index = list.findIndex(i => GV(i.entry) === value);
    if (index === NOT_FOUND) {
      value = GV(list[FIRST].entry);
      return;
    }
    if (index === list.length - ARRAY_OFFSET) {
      // Loop around
      value = GV(list[FIRST].entry);
      return;
    }
    value = GV(list[index + INCREMENT].entry);
  }

  /**
   * on left key press - attempt to move to left menu
   */
  function onLeft(): void {
    if (is.empty(opt.left) || selectedType === "left") {
      return;
    }
    transferCursor();
    selectedType = "left";
    component.render(false);
  }

  /**
   * On right key press - attempt to move editor to right side
   */
  function onRight(): void {
    if (is.empty(opt.right) || selectedType === "right") {
      return;
    }
    transferCursor();
    selectedType = "right";
    component.render(false);
  }

  function onSearchFindInputKeyPress(key: string) {
    let update = false;
    setImmediate(() => component.render(update));
    const searchLength = searchText.length;
    switch (key) {
      case "left": {
        searchCursor = Math.max(START, searchCursor - INCREMENT);
        update = true;
        return;
      }
      case "right": {
        searchCursor = Math.min(searchLength, searchCursor + INCREMENT);
        update = true;
        return;
      }
      case "end": {
        searchCursor = searchLength;
        update = true;
        return;
      }
      case "home": {
        searchCursor = START;
        update = true;
        return;
      }
      case "pagedown":
      case "down": {
        mode = "find-navigate";
        // * Move the top available item for the correct expected column
        const all = side(selectedType);
        let available = filterMenu(all, selectedType);
        if (is.empty(available)) {
          available = all;
        }
        value = GV(available[START].entry);
        return;
      }
      case "backspace": {
        if (searchCursor === START) {
          return;
        }
        searchText = [...searchText]
          .filter((_, index) => index !== searchCursor - ARRAY_OFFSET)
          .join("");
        searchCursor = Math.max(START, searchCursor - INCREMENT);
        update = true;
        return;
      }
      case "delete": {
        // no need for cursor adjustments
        searchText = [...searchText].filter((_, index) => index !== searchCursor).join("");
        update = true;
        return;
      }
      case "space":
        key = " ";
      // fall through
      default:
        if (key.length > SINGLE) {
          return;
        }
        searchText = [
          searchText.slice(START, searchCursor),
          key,
          searchText.slice(searchCursor),
        ].join("");
        searchCursor++;
        update = true;
    }
  }

  /**
   * Key handler for widget while in search mode
   */
  function onSearchKeyPress(key: string): void {
    let update = false;
    setImmediate(() => component.render(update));
    // ? Everywhere actions
    if (key === "escape") {
      // * Clear search text
      searchText = "";
      searchCursor = START;
      update = true;
      return;
    }
    if (mode === FIND_INPUT) {
      onSearchFindInputKeyPress(key);
      return;
    }
    const all = side(selectedType);
    let available = filterMenu(all, selectedType);
    if (is.empty(available)) {
      available = all;
    }
    const index = available.findIndex(({ entry }) => GV(entry) === value);
    if (["pageup", "up"].includes(key) && index == START) {
      mode = FIND_INPUT;
      update = true;
      return;
    }
    switch (key) {
      case "backspace": {
        // * Back
        searchText = searchText.slice(START, ARRAY_OFFSET * INVERT_VALUE);
        searchCursor = searchText.length;
        update = true;
        return;
      }
      case "up":
      case "down":
      case "home":
      case "pageup":
      case "end":
      case "pagedown": {
        navigateSearch(key);
        return;
      }
      case "space": {
        searchText += " ";
        update = true;
        return;
      }
      case "left": {
        onLeft();
        return;
      }
      case "right": {
        onRight();
        return;
      }
    }
    if (key.length > SINGLE) {
      // These don't currently render in the help
      // if (!is.undefined(opt.keyMap[key])) {
      //   value = GV(opt.keyMap[key]);
      //   onEnd();
      // }
      return;
    }
    searchText += key;
    searchCursor = searchText.length;
    update = true;
  }

  /**
   * Attempt to move up 1 item in the active list
   */
  function previous(): void {
    setImmediate(() => component.render(false));
    const list = side(selectedType);
    const index = list.findIndex(i => GV(i.entry) === value);
    if (index === NOT_FOUND) {
      value = GV(list[FIRST].entry);
      return;
    }
    if (index === FIRST) {
      // Loop around
      value = GV(list[list.length - ARRAY_OFFSET].entry);
      return;
    }
    value = GV(list[index - INCREMENT].entry);
  }

  /**
   * Simple toggle function
   */
  function toggleFind(): void {
    mode = mode === "select" ? FIND_INPUT : "select";
    if (mode === "select") {
      detectSide();
      setKeymap();
    } else {
      // move value to top of column
      const list = side(selectedType);
      value = GV(list[FIRST].entry);

      terminal.keyboard.setKeymap(
        component,
        new Map([
          [
            {
              catchAll: true,
              description: "onSearchKeyPress",
              powerUser: true,
            },
            onSearchKeyPress,
          ],
          [{ description: "select entry", key: "enter" }, () => component.onEnd()],
          [{ description: "toggle find", key: "tab" }, toggleFind],
        ]),
      );
    }
    component.render(false);
  }

  /**
   * Move cursor to the top of the current list
   */
  function top(): void {
    const list = side(selectedType);
    value = GV(list[FIRST].entry);
    component.render(false);
  }

  /**
   * Run through the available sections that are available for rendering
   *
   * These are considered in order of priority.
   * If an item cannot be displayed, then it and all lower priority items will be skipped
   *
   * The goal is to maintain as much functionality as possible as the screen shrinks
   */
  function assembleMessage(construction: MenuConstruction): string {
    let height = terminal.environment.getHeight();
    let caught = false;

    const assemble = new Set(
      PRIORITY_ORDER.filter(i => {
        if (caught || is.undefined(construction[i])) {
          return false;
        }
        height -= construction[i].height;
        if (height <= NONE) {
          caught = true;
          return false;
        }
        return true;
      }),
    );
    return CONSTRUCTION_ORDER.filter(i => assemble.has(i))
      .map(i => construction[i]?.text)
      .filter(i => is.string(i))
      .join(`\n`);
  }

  /**
   * Auto detect selectedType based on the current value
   */
  function detectSide(): void {
    const isLeftSide = side("left").some(i => GV(i.entry) === value);
    selectedType = isLeftSide ? "left" : "right";
  }

  /**
   * Search mode - limit results based on the search text
   *
   * If requested, update the value value of value so it super definitely has a valid value
   * This can get lost if label and value were provided together
   *
   * ```json
   * { entry: ["combined"] }
   * ```
   */
  function filterMenu(
    data: MainMenuEntry<VALUE>[],
    side: LR,
    updateValue = false,
  ): MainMenuEntry<VALUE>[] {
    const enabled = side === "left" ? searchEnabledLeft : searchEnabledRight;
    if (!enabled) {
      return data;
    }
    const highlighted = searchCache.current[side];

    if (!updateValue) {
      return highlighted;
    }

    const otherSide = searchCache.current[side === "left" ? "right" : "left"];

    // you filtered yourself out of a value!
    if (is.empty(highlighted) && is.empty(otherSide)) {
      value = undefined;
      return [];
    }

    // other side is selected
    if (selectedType !== side) {
      // keep cursor over there if there is a value to select still
      if (!is.empty(otherSide)) {
        return highlighted;
      }
      // transfer!
      selectedType = side;
    }

    if (mode === "find-input") {
      value = GV(highlighted[FIRST]);
      return highlighted;
    }

    const exists = highlighted.some(i => GV(i) === value);
    if (exists) {
      // if the value still exists in the current list, don't do anything
      return highlighted;
    }

    // TODO might be a workflow issue that can be resolved here
    if (is.empty(searchCache.old)) {
      // is there any reference data to work with?
      // if not, just select the first entry
      value = GV(highlighted[START]);
      return highlighted;
    }

    // find the index of the entry where it used to live
    const previousIndex = searchCache.old[side].findIndex(i => GV(i) === value);
    if (previousIndex === NOT_FOUND) {
      // no idea, give up
      value = GV(highlighted[START]);
      return highlighted;
    }

    // if the index is beyond the bottom of the current list, move cursor to last item
    if (previousIndex > highlighted.length) {
      value = GV(highlighted[highlighted.length - ARRAY_OFFSET]);
      return highlighted;
    }

    // we're somewhere internal to the list still!
    //
    value = is.empty(highlighted) ? undefined : GV(highlighted[previousIndex]);
    return highlighted;
  }

  function transferCursor() {
    const { left, right } = filteredRangedSides();
    const leftRange = visualRange(left);
    const rightRange = visualRange(right);

    const current = selectedType === "left" ? leftRange : rightRange;
    const other = selectedType === "right" ? leftRange : rightRange;

    const currentIndex = current.indexOf(value);
    const reversedIndex = other.length - ARRAY_OFFSET - currentIndex;
    value = other
      .toReversed()
      .find((item, index) => index >= reversedIndex && item !== BLANK_SPACE) as VALUE;
  }

  function filteredRangedSides() {
    let [right, left] = [side("right"), side("left")];

    if (mode !== "select") {
      let availableRight = filterMenu(right, "right");
      let availableLeft = filterMenu(left, "left");
      availableRight = is.empty(availableRight) ? right : availableRight;
      availableLeft = is.empty(availableLeft) ? left : availableLeft;
      left = availableLeft;
      right = availableRight;
    }

    return {
      left: terminal.text.selectRange(left, value),
      right: terminal.text.selectRange(right, value),
    };
  }

  function visualRange(list: MainMenuEntry<VALUE>[]) {
    let previous: string | symbol;
    return list.flatMap(i => {
      if (previous === i.type) {
        return GV(i);
      }
      previous = i.type;
      return [BLANK_SPACE, GV(i)];
    });
  }

  function findKeyEntry(map: KeyMap<VALUE>, key: string) {
    if (map[key]) {
      return map[key];
    }
    const item = Object.entries(map).find(([, item]) => {
      if (is.array(item)) {
        return false;
      }
      const alias = item.alias ?? [];
      return alias.includes(key);
    });
    return item ? (item[VALUE] as AdvancedKeymap<VALUE>).entry : undefined;
  }

  /**
   * The final frame of a menu, informing what happened
   */
  function renderFinal() {
    const item = selectedEntry();
    let message = terminal.text.mergeHelp("", item);
    message += template(` {cyan >} `);
    if (!is.empty(item?.icon)) {
      message += `${item.icon} `;
    }
    if (!is.empty(item?.type)) {
      message += template(`{magenta.bold [${item.type}]} `);
    }

    message += chalk.blue(item?.entry[LABEL]);
    terminal.screen.render(message);
  }

  /**
   * Rendering for search mode
   */
  function renderFind(updateValue = false): void {
    searchCache.old = searchCache.current;
    searchCache.current = {
      left: terminal.text.fuzzyMenuSort(searchText, side("left"), opt.search),
      right: terminal.text.fuzzyMenuSort(searchText, side("right"), opt.search),
    };
    // * Component body
    const sides = {
      left: renderSide("left", false, updateValue),
      right: renderSide("right", false, updateValue),
    };
    const out =
      !is.empty(opt.left) && !is.empty(opt.right)
        ? terminal.text.assemble(
            Object.values(sides).map(i => i.map(x => x.entry[LABEL])) as [string[], string[]],
          )
        : renderSide("right", false, updateValue).map(({ entry }) => entry[LABEL]);
    let bgColor = config.terminal.MENU_SEARCHBOX_NORMAL;
    if (mode === FIND_INPUT) {
      bgColor = is.empty(searchText)
        ? config.terminal.MENU_SEARCHBOX_EMPTY
        : config.terminal.MENU_SEARCHBOX_CONTENT;
    }

    const search = terminal.text.searchBoxEditable({
      bgColor,
      cursor: mode === FIND_INPUT ? searchCursor : undefined,
      padding: SINGLE,
      placeholder: "Type to filter",
      value: searchText,
      width: 100,
    });
    const entries = selectedType === "left" ? sides.left : sides.right;

    const message = terminal.text.mergeHelp(
      [...search, " ", ...out].join(`\n`),
      entries.find(({ entry }) => GV(entry) === value),
    );
    terminal.screen.render(message, terminal.keymap.keymapHelp({ message, notes: notes() }));
  }

  /**
   * Rendering for standard keyboard navigation
   */
  function renderSelect() {
    const construction = {} as MenuConstruction;

    // * Very top text, error / response text
    if (!is.empty(callbackOutput) && callbackTimestamp.isAfter(dayjs().subtract(PAIR, "second"))) {
      construction.alert = CONSTRUCTION_PROP(callbackOutput + `\n\n`);
    }

    // * Header message
    if (!is.empty(opt.headerMessage)) {
      let headerMessage = opt.headerMessage;
      if (is.array(headerMessage)) {
        const stringArray = (headerMessage as string[]).every(i => is.string(i));
        if (stringArray) {
          headerMessage = headerMessage.join(`\n`);
        } else {
          const message = headerMessage as [key: string, value: string][];
          const max = ansiMaxLength(message.map(([label]) => label)) + INCREMENT;
          headerMessage = message
            .map(([label, value]) => chalk`{bold ${ansiPadEnd(label + ":", max)}} ${value}`)
            .join(`\n`);
        }
      }
      construction.header = CONSTRUCTION_PROP(headerMessage + `\n\n`);
    }

    const sides = [renderSide("left"), renderSide("right")];
    // * Component body
    const out = is.empty(opt.left)
      ? renderSide("right").map(({ entry }) => entry[LABEL])
      : terminal.text.assemble(sides.map(i => i.map(x => x.entry[LABEL])) as [string[], string[]]);

    construction.columnHeaders = CONSTRUCTION_PROP(
      opt.showHeaders ? `\n  ${out.shift()}\n ` : `\n \n`,
    );
    construction.body = CONSTRUCTION_PROP(out.map(i => `  ${i}`).join(`\n`));

    const selectedItem = side(selectedType).find(({ entry }) => GV(entry) === value);

    // * Item help text
    if (!is.empty(selectedItem?.helpText)) {
      construction.helpText = CONSTRUCTION_PROP(
        template(`\n \n {blue.dim ?} ${terminal.text.helpFormat(selectedItem.helpText)}`),
      );
    }

    construction.keybindings = CONSTRUCTION_PROP(renderSelectKeymap());

    const dividerWidth = terminal.environment.limitWidth(
      ...Object.keys(construction).map(
        // ? Single extra past the end for "padding"
        key => construction[key as keyof typeof construction].width + INCREMENT,
      ),
    );

    const line = `=`.repeat(dividerWidth);
    construction.divider = CONSTRUCTION_PROP(template(`{${config.terminal.HELP_DIVIDER} ${line}}`));

    const message = assembleMessage(construction);
    terminal.screen.render(message);
  }

  function renderSelectKeymap() {
    const prefix = Object.keys(opt.keyMap).map(key => {
      let item = opt.keyMap[key];
      let highlight: HighlightCallbacks<VALUE>;
      const aliases: string[] = [];
      // ? Advanced keymaps = highlighting support
      if (isAdvanced(item as AdvancedKeymap<VALUE>)) {
        const advanced = item as AdvancedKeymap<VALUE>;
        highlight = is.string(advanced.highlight)
          ? {
              normal: chalk.green.dim,
              valueMatch: chalk.green.bold,
            }
          : advanced.highlight;
        item = advanced.entry;
        if (!is.empty(advanced.alias)) {
          aliases.push(...advanced.alias);
        }
      }
      if (!is.array(item)) {
        return undefined;
      }
      const [label] = item;
      return [
        {
          description: (is.string(label) ? label : label.name) + "  ",
          highlight: is.undefined(highlight)
            ? undefined
            : {
                highlightMatch: (value: unknown) => GV(item) === value,
                ...highlight,
              },
          key: [key, ...aliases],
        } as TTYKeypressOptions,
        () => {},
      ];
    });
    return terminal.keymap.keymapHelp({
      current: value,
      onlyHelp: true,
      prefix: new Map(prefix.filter(item => !is.undefined(item)) as PrefixArray[]),
    });
  }

  /**
   * Render a menu from a side
   */

  function renderSide(
    side: "left" | "right" = selectedType,
    header = opt.showHeaders,
    updateValue = false,
  ): MainMenuEntry[] {
    const { out, maxType, maxLabel, menu } = renderSideSetup(side, updateValue);

    let last = "";
    menu.forEach(item => {
      // * Grouping label
      let prefix = ansiPadEnd(item.type, maxType);
      // ? Optionally, make it fancy
      if (opt.titleTypes) {
        prefix = internal.utils.titleCase(prefix);
      }
      // ? If it is the same as the previous one (above), then render blank space
      if (last === prefix) {
        prefix = " ".repeat(maxType);
      } else {
        // ? Hand off from one type to another
        // Insert a blank line in between
        // Hope everything is sorted
        if (last !== "" && (mode === "select" || is.empty(searchText))) {
          out.push({ entry: [" "] });
        }
        last = prefix;
        prefix = chalk(prefix);
      }

      // ? Where the cursor is
      const highlight = GV(item) === value;
      const padded = ansiPadEnd(
        // ? If an icon exists, provide it and append a space
        (is.empty(item.icon) ? "" : `${item.icon} `) + item.entry[LABEL],
        maxLabel,
      );

      // ? When rendering the column with the cursor in it, add extra colors
      if (selectedType === side) {
        const color = highlight
          ? config.terminal.MENU_ENTRY_SELECTED
          : config.terminal.MENU_ENTRY_NORMAL;
        out.push({
          ...item,
          entry: [
            // ? {grouping type in magenta} {item}
            template(` {${config.terminal.MENU_ENTRY_TYPE} ${prefix}} {${color}  ${padded}}`),
            GV(item.entry),
          ],
        });
        return;
      }
      // ? Alternate column in boring gray
      const text = template(
        ` {${config.terminal.MENU_ENTRY_TYPE_OTHER} ${prefix}}  {${config.terminal.MENU_ENTRY_OTHER} ${padded}}`,
      );
      out.push({
        ...item,
        entry: [text, GV(item.entry)],
      });
    });

    // ? This, annoyingly, is the easiest way to assemble headers
    const max = ansiMaxLength(...out.map(({ entry }) => entry[LABEL]));
    if (header) {
      out.unshift({
        entry: [chalk.bold.blue.dim(renderSideHeader(side, max)), Symbol.for("header_object")],
      });
    }

    return out;
  }

  function renderSideHeader(side: "left" | "right", max: number): string {
    const padding = " ".repeat(headerPadding);
    if (side === "left") {
      return `${leftHeader}${padding}`.padStart(max, " ");
    }
    return `${padding}${rightHeader}`.padEnd(max, " ");
  }

  function renderSideSetup(selected: "left" | "right" = selectedType, updateValue = false) {
    const out: MainMenuEntry[] = [];
    let menu = side(selected);
    if (mode !== "select") {
      menu = filterMenu(menu, selected, updateValue);
    }
    const temporary = terminal.text.selectRange(menu, value);
    menu = temporary.map(i => menu.find(({ entry }) => GV(i) === GV(entry)));

    const maxType = ansiMaxLength(...menu.map(({ type }) => type));
    const maxLabel =
      ansiMaxLength(
        ...menu.map(({ entry, icon }) => entry[LABEL] + (is.empty(icon) ? "" : `${icon} `)),
      ) + ARRAY_OFFSET;
    if (is.empty(menu) && !opt.keyOnly) {
      out.push({
        entry: [
          opt.emptyMessage ??
            template(` {yellowBright.inverse.bold  No ${opt.item} to select from }`),
        ],
      });
    }
    return { maxLabel, maxType, menu, out };
  }

  function searchItems(findValue: VALUE, restore: MenuRestore): MainMenuEntry<string | VALUE> {
    return [...opt.left, ...opt.right].find(entry => {
      const local = GV(entry);
      const value = findValue;
      // quick filter for bad matches
      if (typeof value !== typeof local) {
        return false;
      }
      if (
        restore?.type === "value" &&
        !is.empty(restore?.idProperty) &&
        is.object(local) &&
        is.object(value)
      ) {
        // Multiple id paths may show up in mixed object type menus
        if (is.array(restore.idProperty)) {
          const out = restore.idProperty.find(id => {
            const a = internal.utils.object.get(local as object, id);
            const b = internal.utils.object.get(value as object, id);
            if (is.undefined(a) || is.undefined(b)) {
              return false;
            }
            return is.equal(a, b);
          });
          return !!out;
        }
        const a = internal.utils.object.get(value, restore?.idProperty);
        const b = internal.utils.object.get(local, restore?.idProperty);
        if (is.undefined(a) || is.undefined(b)) {
          return false;
        }
        return is.equal(a, b);
      }
      return is.equal(local, value as typeof local);
    });
  }

  function selectedEntry(): MainMenuEntry {
    const values = Object.values(opt.keyMap);
    return [
      ...side("right"),
      ...side("left"),
      ...values.map(entry => ({ entry }) as MainMenuEntry<VALUE>),
    ].find(item => GV(item.entry) === value);
  }

  function setKeymap(): void {
    // show if keyOnly, or falsy condensed
    const hidden = opt.keyOnly || opt.condensed;
    const PARTIAL_LIST: tMenuItem[] = [
      [{ catchAll: true, description: "everything else", powerUser: true }, activateKeyMap],
      ...(opt.keyOnly
        ? []
        : ([
            [{ description: "next", key: "down" }, next],
            [{ description: "select entry", key: "enter" }, () => component.onEnd()],
            [{ description: "previous", key: "up" }, previous],
          ] as tMenuItem[])),

      [
        {
          description: "move to bottom",
          key: ["end", "pagedown"],
          powerUser: hidden,
        },
        bottom,
      ],
      [
        {
          description: "move to top",
          key: ["home", "pageup"],
          powerUser: hidden,
        },
        top,
      ],
    ];
    const LEFT_RIGHT: tMenuItem[] = [
      [{ description: "left", key: "left" }, onLeft],
      [{ description: "right", key: "right" }, onRight],
    ];
    const SEARCH: tMenuItem[] = [[{ description: "toggle find", key: "tab" }, toggleFind]];

    const search_keymap = !searchEnabled || opt.keyOnly ? [] : SEARCH;
    const left_right = is.empty(opt.left) || is.empty(opt.right) ? [] : LEFT_RIGHT;

    const keymap = new Map([...PARTIAL_LIST, ...left_right, ...search_keymap]);
    terminal.keyboard.setKeymap(component, keymap);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function setValue(incoming: VALUE, restore: MenuRestore): Promise<void> {
    value = undefined;

    // If the dev provided a value, then it takes priority
    if (!is.undefined(incoming)) {
      // Attempt to find the value in the list of options
      // If restore information is provided, then use that to help with comparisons
      const item = searchItems(incoming, restore);
      if (item) {
        // Translate value reference to the one off the entry
        // Makes comparisons easier inside the component
        value = GV(item);
        return;
      }
    }

    // If a restore id is available, attempt to get data from that
    if (!is.empty(restore?.id)) {
      const data = await cache.get<MenuRestoreCacheData<VALUE>>(CACHE_KEY_RESTORE(restore.id));

      if (data) {
        // Position based value restoration
        if (restore.type === "position") {
          const [selected] = data.position;
          let [, position] = data.position;
          const list = side(selected);
          // Next closet item in the list
          if (!is.empty(list) && is.undefined(list[position])) {
            position = list.length - ARRAY_OFFSET;
          }
          // If the position does not actually exist, then normal default will be selected
          if (!is.undefined(list[position])) {
            value = GV(list[position]);
            return;
          }
        }
        // Value based restoration
        if (restore.type === "value") {
          const item = searchItems(data.value, restore);
          if (item) {
            value = GV(item);
            return;
          }
        }
      }
    }

    // Attempts to restore have failed, find a sane default
    let list = side("right");
    list = is.empty(list) ? side("left") : list;
    const top = list[FIRST];
    if (top) {
      value = GV(top);
    }

    // I guess value doesn't matter if there's no options?
  }

  /**
   * Retrieve the list of entries. Default is current side, aware of find mode
   *
   * Sorting logic:
   *  - Type sorting: priority set by highest level item inside type, then alphabetical
   *  - Items sorted within types, priority first, then ansi stripped label
   */

  function side(side: "left" | "right"): MainMenuEntry<VALUE>[] {
    let temp = opt[side].map(item => [
      item,
      ansiStrip(item.entry[LABEL]).replaceAll(new RegExp("[^A-Za-z0-9]", "g"), ""),
    ]) as [MainMenuEntry, string][];
    if (sort) {
      // Run through all the menu items, and find the highest priority for each type
      const maxPriority: Record<string, number> = {};
      temp.forEach(([{ priority = NONE, type }]) => {
        maxPriority[type] = Math.max(maxPriority[type] ?? NONE, priority);
      });
      // type priority > type alphabetical > item priority > item alphabetical
      temp = temp.sort(([a, aLabel], [b, bLabel]) => {
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
    }
    return temp.map(([item]) => item as MainMenuEntry<VALUE>);
  }

  const component = terminal.registry.registerComponent("menu", {
    async configure(
      config: MenuComponentOptions<VALUE>,
      isDone: (type: VALUE) => void,
    ): Promise<void> {
      // * Reset from last run
      LAST_RESULT = undefined;
      searchText = "";
      searchCursor = START;
      complete = false;
      final = false;
      searchEnabledLeft = false;
      searchEnabledRight = false;
      opt = config;

      searchEnabled = isSearchEnabled(opt.search);
      // * Expected to basically always be true
      if (searchEnabled) {
        const options = (config.search ?? {}) as BaseSearchOptions;
        options.left ??= true;
        options.right ??= true;
        searchEnabledLeft = options.left;
        searchEnabledRight = options.right;
      }

      // * Set up defaults in the config
      opt.left ??= [];
      opt.item ??= "actions";
      opt.right ??= [];
      opt.showHeaders ??= !is.empty(opt.left);
      opt.left.forEach(i => (i.type ??= ""));
      opt.right.forEach(i => (i.type ??= ""));
      opt.keyMap ??= {};

      done = isDone;

      // * Set local properties based on config
      headerPadding = config.headerPadding ?? DEFAULT_HEADER_PADDING;
      rightHeader = config.rightHeader || "Menu";
      leftHeader =
        config.leftHeader ||
        (!is.empty(config.left) && !is.empty(config.right) ? "Secondary" : "Menu");

      // Dev can force sorting either way
      // If types are provided on items, then sorting is enabled by default to properly group types
      // Otherwise, order in = order out
      sort = config.sort ?? [...config.left, ...config.right].some(({ type }) => !is.empty(type));

      // * Finial init
      await setValue(config.value, config.restore);
      detectSide();
      setKeymap();
    },

    /**
     * Terminate the editor
     */
    onEnd() {
      if (!done) {
        return;
      }
      const list = side(selectedType);
      const index = list.findIndex(entry => GV(entry) === (selectedValue ?? value));
      final = true;
      mode = "select";
      callbackOutput = "";
      done(value);
      LAST_RESULT ??= {
        returned: value,
        selected_entry: undefined,
        type: "entry",
      };
      LAST_RESULT.selected_entry = {
        entry: list[index],
        index,
        side: selectedType,
      };
      component.render();
      done = undefined;
      if (opt.restore) {
        setImmediate(async () => {
          await cache.set<MenuRestoreCacheData<VALUE>>(CACHE_KEY_RESTORE(opt.restore?.id), {
            position: [selectedType, index],
            value: GV(list[index]) ?? value,
          });
        });
      }
    },

    /**
     * Entrypoint for rendering logic
     */
    render(updateValue: boolean = false): void {
      terminal.application.reprintHeader();
      // Complete = this widget must have `configure()` called prior to doing more rendering
      if (complete) {
        return;
      }
      // Final = this widget has returned a value,
      //   and wants to clean up the UI a bit before finishing
      if (final) {
        final = false;
        complete = true;
        return renderFinal();
      }
      // VVVVV Normal rendering work VVVVV
      if (mode === "select") {
        return renderSelect();
      }
      renderFind(updateValue);
    },
  });

  return async <VALUE = unknown>(options: MenuComponentOptions<string | VALUE>) =>
    await terminal.prompt.menu<VALUE>(options);
}
