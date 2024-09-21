/* eslint-disable @typescript-eslint/no-magic-numbers */
import {
  ARRAY_OFFSET,
  EMPTY,
  INCREMENT,
  INVERT_VALUE,
  is,
  ONE_THIRD,
  SINGLE,
  START,
  TServiceParams,
  VALUE,
} from "@digital-alchemy/core";
import { parse, parseDate } from "chrono-node";
import dayjs, { Dayjs } from "dayjs";

import { DirectCB, KeyModifiers, TTYComponentKeymap, TTYKeypressOptions } from "../../helpers";

export enum TTYDateTypes {
  datetime = "datetime",
  date = "date",
  time = "time",
  range = "range",
}
type tDateType = `${TTYDateTypes}`;
export enum TTYFuzzyTypes {
  always = "always",
  never = "never",
  user = "user",
}
export interface DateEditorEditorOptions {
  /**
   * Current date in granular format
   */
  current?: string;
  /**
   * String to represent the date in fuzzy format
   */
  currentFuzzy?: string;
  /**
   * fuzzy is default
   */
  defaultStyle?: "fuzzy" | "granular";
  /**
   * Interpret values with chrono-node
   */
  fuzzy?: `${TTYFuzzyTypes}`;
  /**
   * Text that should appear the blue bar of the help text
   */
  helpNotes?: string | ((current: Date | Date[]) => string);
  label?: string;
  type?: tDateType;
}

// TODO: There is probably a way to make dayjs give me this info
// Except, better, because it can account for stuff like leap years
const MONTH_MAX = new Map([
  [1, 31],
  [2, 29],
  [3, 31],
  [4, 30],
  [5, 31],
  [6, 30],
  [7, 31],
  [8, 31],
  [9, 30],
  [10, 31],
  [11, 30],
  [12, 31],
]);
const DEFAULT_PLACEHOLDER = "tomorrow at noon";
const DEFAULT_RANGE_PLACEHOLDER = "tomorrow at noon to next friday";
const PADDING = 2;

type DATE_TYPES = "day" | "hour" | "minute" | "month" | "second" | "year";
const SORTED = ["year", "month", "day", "hour", "minute", "second"] as DATE_TYPES[];

export function DateEditor({ terminal, config }: TServiceParams) {
  const { chalk, template } = terminal.internals;

  const VALUES: Record<DATE_TYPES, string> = {
    day: "",
    hour: "",
    minute: "",
    month: "",
    second: "",
    year: "",
  };
  const END_VALUES: Record<DATE_TYPES, string> = {
    day: "",
    hour: "",
    minute: "",
    month: "",
    second: "",
    year: "",
  };
  let chronoText: string;
  let complete = false;
  let cursor: number;
  let done: (type: string | string[]) => void;
  let edit: DATE_TYPES = "year";
  let end: boolean;
  let error = "";
  let fuzzy: boolean;
  let localDirty: boolean;
  let opt: DateEditorEditorOptions;
  let type: tDateType;
  let value: dayjs.Dayjs | dayjs.Dayjs[];

  function notes(): string {
    const { helpNotes } = opt;
    if (is.string(helpNotes)) {
      return helpNotes;
    }
    if (is.function(helpNotes)) {
      if (is.array(value)) {
        return helpNotes(value.map(i => i.toDate()));
      }
      return helpNotes(value.toDate());
    }
    return `\n `;
  }

  function editField() {
    return end ? VALUES : END_VALUES;
  }

  function editType(key: string) {
    setImmediate(() => editor.render());
    error = "";
    const field = editField();
    if (key === "backspace") {
      field[edit] = field[edit].slice(START, SINGLE * INVERT_VALUE);
      localDirty = true;
      return;
    }
    if (!"1234567890".includes(key)) {
      return;
    }
    const MAX_LENGTH = edit === "year" ? 4 : 2;
    // If it's dirty + at max length, move cursor over first
    if (localDirty && field[edit].length === MAX_LENGTH) {
      const index = SORTED.indexOf(edit);
      // No place to move it over. Give up
      if (index === SORTED.length - ARRAY_OFFSET) {
        return;
      }
      onRight();
    }
    if (!localDirty) {
      field[edit] = key;
      localDirty = true;
      return;
    }
    if (!sanityCheck(field[edit] + key)) {
      return;
    }
    field[edit] += key;
    if (edit === "month") {
      updateMonth();
    }
    if (field[edit].length === MAX_LENGTH) {
      onRight();
    }
  }

  function onDown() {
    setImmediate(() => editor.render());
    error = "";
    const field = editField();
    const current = Number(field[edit] || "0");
    if (current === 0) {
      return;
    }
    const previous = (current - INCREMENT)
      .toString()
      // lol 420
      .padStart(edit === "year" ? 4 : 2, "0");
    if (!sanityCheck(previous)) {
      return;
    }
    field[edit] = previous;
    if (edit === "month") {
      updateMonth();
    }
  }

  function onEnd(): void | boolean {
    if (type == "range") {
      editor.render();
      return onEndRange();
    }
    if (fuzzy && is.empty(chronoText)) {
      error = chalk.red`Enter a value`;
      editor.render();
      return;
    }
    if (fuzzy) {
      const [result] = parse(chronoText);
      if (!result) {
        error = chalk.red`Invalid expression`;
        editor.render();
        return;
      }
      if (result.end) {
        error = chalk.red`Expression cannot result in a date range`;
        editor.render();
        return;
      }
    }
    value = dayjs(
      fuzzy
        ? parseDate(chronoText)
        : new Date(
            Number(VALUES.year),
            Number(VALUES.month) - ARRAY_OFFSET,
            Number(VALUES.day),
            Number(VALUES.hour),
            Number(VALUES.minute),
            Number(VALUES.second),
          ),
    );
    complete = true;
    editor.render();
    done(value.toISOString());
  }

  function onKeyPress(key: string, { shift }: KeyModifiers) {
    setImmediate(() => editor.render());
    error = "";
    switch (key) {
      case "space": {
        key = " ";
        break;
      }
      case "left": {
        cursor = cursor <= START ? START : cursor - SINGLE;
        break;
      }
      case "right": {
        cursor = cursor >= chronoText.length ? chronoText.length : cursor + SINGLE;
        break;
      }
      case "home": {
        cursor = START;
        break;
      }
      case "end": {
        cursor = chronoText.length;
        break;
      }
      case "delete": {
        chronoText = [...chronoText].filter((_, index) => index !== cursor).join("");
        // no need for cursor adjustments
        break;
      }
      case "backspace": {
        if (shift) {
          break;
        }
        if (cursor === EMPTY) {
          break;
        }
        chronoText = [...chronoText].filter((_, index) => index !== cursor - ARRAY_OFFSET).join("");
        cursor--;
        break;
      }
    }
    if (key === "tab") {
      return;
    }
    if (key.length > SINGLE) {
      return;
    }
    const value = shift ? key.toUpperCase() : key;
    chronoText = [chronoText.slice(START, cursor), value, chronoText.slice(cursor)].join("");
    cursor++;
  }

  function onLeft(): void {
    const field = editField();
    error = "";
    const index = SORTED.indexOf(edit);
    if (index === START || (type == "time" && edit === "hour")) {
      return;
    }
    field[edit] = field[edit].padStart(edit === "year" ? 4 : 2, "0");
    edit = SORTED[index - INCREMENT];
    localDirty = false;
    editor.render();
  }

  function onRight(): void {
    const field = editField();
    error = "";
    const index = SORTED.indexOf(edit);
    if (index === SORTED.length - ARRAY_OFFSET) {
      return;
    }
    field[edit] = field[edit].padStart(edit === "year" ? 4 : 2, "0");
    edit = SORTED[index + INCREMENT];
    localDirty = false;
    editor.render();
  }

  function onUp(): void {
    const field = editField();
    error = "";
    const next = (Number(field[edit] || "0") + INCREMENT)
      .toString()
      .padStart(edit === "year" ? 4 : 2, "0");
    if (!sanityCheck(next)) {
      return;
    }
    field[edit] = next;
    localDirty = true;
    if (edit === "month") {
      updateMonth();
    }
    editor.render();
  }

  function reset(): void {
    localDirty = false;
    chronoText = "";
    editor.render();
  }

  function setEnd(): void {
    edit = "second";
    localDirty = false;
    editor.render();
  }

  function setHome(): void {
    edit = type === "time" ? "hour" : "year";
    localDirty = false;
    editor.render();
  }

  function setMax(): void {
    setImmediate(() => editor.render());
    const field = editField();
    localDirty = true;
    switch (edit) {
      // year omitted on purpose
      // Not sure what values would make sense to use
      case "month": {
        field[edit] = "12";
        return;
      }
      case "day": {
        field[edit] = MONTH_MAX.get(
          Number(end ? END_VALUES.month || "1" : VALUES.month),
        ).toString();
        return;
      }
      case "hour": {
        field[edit] = "23";
        return;
      }
      case "minute":
      case "second": {
        field[edit] = "59";
        return;
      }
    }
  }

  function setMin(): void {
    setImmediate(() => editor.render());
    const field = editField();
    localDirty = true;
    switch (edit) {
      // year omitted on purpose
      // Not sure what values would make sense to use
      case "month":
      case "day": {
        field[edit] = "01";
        return;
      }
      case "hour":
      case "minute":
      case "second": {
        field[edit] = "00";
        return;
      }
    }
  }

  function toggleChrono(): void {
    error = "";
    fuzzy = !fuzzy;
    setKeymap();
    editor.render();
  }

  function toggleRangeSide(): void {
    end = !end;
    editor.render();
  }

  function onEndRange(): boolean | void {
    if (fuzzy) {
      if (is.empty(chronoText)) {
        error = template(`{red Enter a value}`);
        editor.render();
        return;
      }
      const [result] = parse(chronoText);
      if (!result.end) {
        error = template(`{red Value must result in a date range}`);
        editor.render();
        return;
      }
      value = [dayjs(result.start.date()), dayjs(result.end.date())];
    } else {
      value = [
        dayjs(
          new Date(
            Number(VALUES.year),
            Number(VALUES.month) - ARRAY_OFFSET,
            Number(VALUES.day),
            Number(VALUES.hour),
            Number(VALUES.minute),
            Number(VALUES.second),
          ),
        ),
        dayjs(
          new Date(
            Number(END_VALUES.year),
            Number(END_VALUES.month) - ARRAY_OFFSET,
            Number(END_VALUES.day),
            Number(END_VALUES.hour),
            Number(END_VALUES.minute),
            Number(END_VALUES.second),
          ),
        ),
      ];
    }
    complete = true;
    editor.render();
    done(value.map(i => i.toISOString()));
    return false;
  }

  function renderChronoBox(): void {
    const placeholder = type === "range" ? DEFAULT_RANGE_PLACEHOLDER : DEFAULT_PLACEHOLDER;
    const value = is.empty(chronoText) ? placeholder : chronoText;
    const out: string[] = [];
    if (opt.label) {
      out.push(template(`${config.terminal.PROMPT_QUESTION} ${opt.label}`));
    }

    const [result] = parse(chronoText.trim() || placeholder);

    const width = terminal.environment.getWidth();
    out.push(
      template(` {cyan >} {bold Input value}`),
      ...terminal.text.searchBoxEditable({
        bgColor: is.empty(chronoText) ? "bgBlue" : "bgWhite",
        cursor: cursor,
        padding: PADDING,
        value,
        width: Math.max(Math.min(40, width), Math.floor(width * ONE_THIRD)),
      }),
    );
    if (result) {
      const { start, end } = result;
      out.push(
        template(`\n {cyan >} {bold Resolved value}`),
        (end ? chalk.bold("Start: ") : "") + start.date().toLocaleString(),
      );
      if (end) {
        out.push(template(`  {bold End:} ${end ? end.date().toLocaleString() : ""}`));
      }
    } else {
      out.push("", template(` {cyan >} {bold.red Resolved value}\n{bgYellow.black CANNOT PARSE}`));
    }
    const message = terminal.text.pad(out.join(`\n`));
    terminal.screen.render(
      message,
      (is.empty(error) ? "" : template(`\n{red.bold ! }${error}\n`)) +
        terminal.keymap.keymapHelp({
          message,
          notes: notes(),
        }),
    );
  }

  function renderComplete(): void {
    let message = ``;
    if (is.array(value)) {
      const [from, to] = value;
      message += [
        ``,
        template(`{bold From:} ${from.toDate().toLocaleString()}`),
        template(`{bold   To:} ${to.toDate().toLocaleString()}`),
      ].join(`\n`);
    } else {
      const label = opt.label || type === "time" ? "Time" : "Date";
      message += template(`${config.terminal.PROMPT_QUESTION} {bold ${label}: }`);
      switch (type) {
        case "time": {
          message += value.toDate().toLocaleTimeString();
          break;
        }
        case "date": {
          message += value.toDate().toLocaleDateString();
          break;
        }
        default: {
          message += value.toDate().toLocaleString();
        }
      }
    }
    terminal.screen.render(message);
  }

  /**
   * TODO: refactor these render sections methods into something more sane
   * This is super ugly
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function renderRangeSections(): void {
    let message = template(
      `  ${config.terminal.PROMPT_QUESTION} ${
        opt.label ?? chalk.bold`Enter date range`
      }  \n{bold From:} `,
    );
    // From
    if (["range", "date", "datetime"].includes(type)) {
      const { year, month, day } = VALUES;
      message +=
        edit === "year" && !end
          ? chalk[is.empty(year) ? "bgBlue" : "bgWhite"].black(year.padEnd(4, " "))
          : year.padEnd(4, " ");
      message += `-`;
      message +=
        edit === "month" && !end
          ? chalk[is.empty(month) ? "bgBlue" : "bgWhite"].black(month.padEnd(2, " "))
          : month.padEnd(2, " ");
      message += `-`;
      message +=
        edit === "day" && !end
          ? chalk[is.empty(day) ? "bgBlue" : "bgWhite"].black(day.padEnd(2, " "))
          : day.padEnd(2, " ");
      message += ` `;
    }
    if (["range", "time", "datetime"].includes(type)) {
      const { minute, hour, second } = VALUES;
      message +=
        edit === "hour" && !end
          ? chalk[is.empty(hour) ? "bgBlue" : "bgWhite"].black(hour.padEnd(2, " "))
          : hour.padEnd(2, " ");
      message += `:`;
      message +=
        edit === "minute" && !end
          ? chalk[is.empty(minute) ? "bgBlue" : "bgWhite"].black(minute.padEnd(2, " "))
          : minute.padEnd(2, " ");
      message += `:`;
      message +=
        edit === "second" && !end
          ? chalk[is.empty(second) ? "bgBlue" : "bgWhite"].black(second.padEnd(2, " "))
          : second.padEnd(2, " ");
    }
    message += chalk`\n  {bold To:} `;
    // To
    if (["range", "date", "datetime"].includes(type)) {
      const { year, month, day } = END_VALUES;
      message +=
        edit === "year" && end
          ? chalk[is.empty(year) ? "bgBlue" : "bgWhite"].black(year.padEnd(4, " "))
          : year.padEnd(4, " ");
      message += `-`;
      message +=
        edit === "month" && end
          ? chalk[is.empty(month) ? "bgBlue" : "bgWhite"].black(month.padEnd(2, " "))
          : month.padEnd(2, " ");
      message += `-`;
      message +=
        edit === "day" && end
          ? chalk[is.empty(day) ? "bgBlue" : "bgWhite"].black(day.padEnd(2, " "))
          : day.padEnd(2, " ");
      message += ` `;
    }
    if (["range", "time", "datetime"].includes(type)) {
      const { minute, hour, second } = END_VALUES;
      message +=
        edit === "hour" && end
          ? chalk[is.empty(hour) ? "bgBlue" : "bgWhite"].black(hour.padEnd(2, " "))
          : hour.padEnd(2, " ");
      message += `:`;
      message +=
        edit === "minute" && end
          ? chalk[is.empty(minute) ? "bgBlue" : "bgWhite"].black(minute.padEnd(2, " "))
          : minute.padEnd(2, " ");
      message += `:`;
      message +=
        edit === "second" && end
          ? chalk[is.empty(second) ? "bgBlue" : "bgWhite"].black(second.padEnd(2, " "))
          : second.padEnd(2, " ");
    }
    terminal.screen.render(
      message,
      (is.empty(error) ? "" : template(`\n{red.bold ! }${error}\n`)) +
        terminal.keymap.keymapHelp({
          message,
          notes: notes(),
        }),
    );
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  function renderSections(): void {
    let message = template(
      `  ${config.terminal.PROMPT_QUESTION} ${
        opt.label ?? (type === "time" ? "Enter time" : "Enter date")
      }  `,
    );
    if (["range", "date", "datetime"].includes(type)) {
      const { year, month, day } = VALUES;
      message +=
        edit === "year"
          ? chalk[is.empty(year) ? "bgBlue" : "bgWhite"].black(year.padEnd(4, " "))
          : year.padEnd(4, " ");
      message += `-`;
      message +=
        edit === "month"
          ? chalk[is.empty(month) ? "bgBlue" : "bgWhite"].black(month.padEnd(2, " "))
          : month.padEnd(2, " ");
      message += `-`;
      message +=
        edit === "day"
          ? chalk[is.empty(day) ? "bgBlue" : "bgWhite"].black(day.padEnd(2, " "))
          : day.padEnd(2, " ");
      message += ` `;
    }
    if (["range", "time", "datetime"].includes(type)) {
      const { minute, hour, second } = VALUES;
      message +=
        edit === "hour"
          ? chalk[is.empty(hour) ? "bgBlue" : "bgWhite"].black(hour.padEnd(2, " "))
          : hour.padEnd(2, " ");
      message += `:`;
      message +=
        edit === "minute"
          ? chalk[is.empty(minute) ? "bgBlue" : "bgWhite"].black(minute.padEnd(2, " "))
          : minute.padEnd(2, " ");
      message += `:`;
      message +=
        edit === "second"
          ? chalk[is.empty(second) ? "bgBlue" : "bgWhite"].black(second.padEnd(2, " "))
          : second.padEnd(2, " ");
    }
    terminal.screen.render(
      message,
      (is.empty(error) ? "" : template(`\n{red.bold ! }${error}\n`)) +
        terminal.keymap.keymapHelp({
          message,
          notes: notes(),
        }),
    );
  }

  function sanityCheck(update: string): boolean {
    const value = Number(update);
    switch (edit) {
      case "year": {
        return update.length <= 4;
      }
      case "month": {
        // Using real month numbers, not 0-11 like some sort of demented monkey
        return value <= 12 && value > 0;
      }
      case "hour": {
        // midnight = 0, 11pm = 23
        return value <= 23 && value >= 0;
      }
      case "minute":
      case "second": {
        // 0-59
        return value >= 0 && value < 60;
      }
      case "day": {
        return value > 0 && value <= MONTH_MAX.get(Number(VALUES.month) || 1);
      }
    }
    return false;
  }

  function setKeymap() {
    const FUZZY_KEYMAP: TTYComponentKeymap = new Map([
      [{ catchAll: true, description: "key press", powerUser: true }, onKeyPress],
      [{ description: "done", key: "enter" }, onEnd],
      [{ description: "clear", key: "escape" }, reset],
      ...(opt.fuzzy === "user"
        ? ([[{ description: chalk.bold("granular input"), key: "tab" }, toggleChrono]] as [
            TTYKeypressOptions,
            DirectCB,
          ][])
        : []),
    ]);
    const NORMAL_KEYMAP: TTYComponentKeymap = new Map([
      [{ description: "done", key: "enter" }, onEnd],
      [{ description: "reset", key: "escape" }, reset],
      [{ description: "down", key: "down" }, onDown],
      [{ description: "up", key: "up" }, onUp],
      [{ catchAll: true, description: "edit", powerUser: true }, editType],
      [{ description: "cursor left", key: "left" }, onLeft],
      [{ description: "cursor right", key: "right" }, onRight],
      // Other common keys, feels excessive to report them to the user
      [{ description: "right", key: [":", "-", "space"], powerUser: true }, onRight],
      ...(["datetime", "range"].includes(type) && opt.fuzzy === "user"
        ? ([[{ description: chalk.bold("fuzzy input"), key: "tab" }, toggleChrono]] as [
            TTYKeypressOptions,
            DirectCB,
          ][])
        : []),
      ...(type === "range"
        ? ([[{ description: "toggle from / to", key: "tab" }, toggleRangeSide]] as [
            TTYKeypressOptions,
            DirectCB,
          ][])
        : []),
      // "power user features"
      // aka: stuff I'm keeping off the help menu because it's getting cluttered
      [{ description: "set home", key: "home", powerUser: true }, setHome],
      [{ description: "set end", key: "end", powerUser: true }, setEnd],
      [{ description: "set max", key: "pageup", powerUser: true }, setMax],
      [{ description: "set min", key: "pagedown", powerUser: true }, setMin],
    ]);

    terminal.keyboard.setKeymap(editor, fuzzy ? FUZZY_KEYMAP : NORMAL_KEYMAP);
  }

  function updateMonth(): void {
    // Because I'm consistent like that
    const limit = MONTH_MAX.get(Number(VALUES.month)) ?? 28;
    const current = Number(VALUES.day) ?? 1;
    if (current > limit) {
      VALUES.day = limit.toString();
    }
  }

  const editor = terminal.registry.registerEditor("date", {
    configure(config: DateEditorEditorOptions, onDone: (type: unknown) => void): void {
      error = "";
      chronoText = config.currentFuzzy ?? "";
      cursor = chronoText.length;
      opt = config;
      config.fuzzy ??= "user";
      config.defaultStyle ??= config.fuzzy === "never" ? "granular" : "fuzzy";
      type = config.type ?? "datetime";
      // default off
      // ? Make that @InjectConfig controlled?
      fuzzy =
        config.defaultStyle === "fuzzy" ||
        ((["datetime", "range"] as tDateType[]).includes(type) && config.fuzzy === "always");
      complete = false;
      localDirty = false;
      value = dayjs(opt.current);
      done = onDone;
      setKeymap();
      const start = is.array(value) ? (value[START] as Dayjs) : value;
      edit = type === "time" ? "hour" : "year";
      const end = is.array(value) ? ((value[VALUE] ?? value[START]) as Dayjs) : value;
      // const { year, month, day, minute, hour, second } = VALUES;

      const [year, month, day, hour, minute, second] = start
        .format("YYYY-MM-DD-HH-mm-ss")
        .split("-");

      VALUES.year = year;
      VALUES.month = month;
      VALUES.day = day;
      VALUES.hour = hour;
      VALUES.minute = minute;
      VALUES.second = second;

      const [endYear, endMonth, endDay, endHour, endMinute, endSecond] = end
        .format("YYYY-MM-DD-HH-mm-ss")
        .split("-");

      VALUES.year = endYear;
      VALUES.month = endMonth;
      VALUES.day = endDay;
      VALUES.hour = endHour;
      VALUES.minute = endMinute;
      VALUES.second = endSecond;
    },

    render(): void {
      if (complete) {
        renderComplete();
        return;
      }
      if (["datetime", "range"].includes(type) && fuzzy) {
        renderChronoBox();
        return;
      }
      if (type === "range") {
        renderRangeSections();
        return;
      }
      renderSections();
    },
  });
}
