import { ARRAY_OFFSET, HALF, is, SINGLE, START, TServiceParams } from "@digital-alchemy/core";
import chalk from "chalk";

import { ObjectBuilderOptions, TableBuilderElement } from "../helpers";
import { ansiMaxLength } from "../includes";

const PADDING = 1;
const EXTRA = 2;
const MIN_CELL_WIDTH = " undefined ".length;
type ColumnInfo = TableBuilderElement & { maxWidth: number };

const BUFFER_SIZE = 3;
export const TABLE_PARTS = {
  bottom: "─",
  bottom_left: "└",
  bottom_mid: "┴",
  bottom_right: "┘",
  left: "│",
  left_mid: "├",
  mid: "─",
  mid_mid: "┼",
  middle: "│",
  right: "│",
  right_mid: "┤",
  top: "─",
  top_left: "┌",
  top_mid: "┬",
  top_right: "┐",
};

export function Table<VALUE extends object = Record<string, unknown>>({
  terminal,
  internal,
  config,
}: TServiceParams) {
  const { ansiPadEnd, template } = terminal.internals;

  Object.keys(TABLE_PARTS).forEach(
    key =>
      (TABLE_PARTS[key as keyof typeof TABLE_PARTS] = chalk.gray.dim(
        TABLE_PARTS[key as keyof typeof TABLE_PARTS],
      )),
  );

  const NAME_CELL = (i: ColumnInfo, max?: number) =>
    template(
      `${" ".repeat(PADDING)}{bold.blue ${i.name.padEnd((max ?? i.maxWidth) - PADDING, " ")}}`,
    );
  let activeOptions: ObjectBuilderOptions<VALUE>;
  let columns: ColumnInfo[];
  let selectedCell: number;
  let selectedRow: number;
  let values: VALUE[];

  function calcColumns(values: VALUE[]): void {
    columns = activeOptions.elements.map(item => {
      item.name ??= internal.utils.titleCase(item.path);
      return {
        maxWidth: Math.max(
          MIN_CELL_WIDTH,
          PADDING + item.name.length + PADDING,
          PADDING +
            ansiMaxLength(
              ...values.map(row => {
                const value = internal.utils.object.get(row, item.path);
                return item.format ? item.format(value) : terminal.text.type(value);
              }),
            ) +
            PADDING,
        ),
        name: item.name,
        path: item.path,
      } as ColumnInfo;
    });
  }

  function footer(join: string = TABLE_PARTS.bottom_mid): string {
    return [
      TABLE_PARTS.bottom_left,
      columns.map(i => TABLE_PARTS.bottom.repeat(i.maxWidth)).join(join),
      TABLE_PARTS.bottom_right,
    ].join("");
  }

  function rows(): string[] {
    return selectRange(
      values.map((i, rowIndex) => {
        return [
          TABLE_PARTS.left,
          ...activeOptions.elements.map((element, colIndex) => {
            const value = internal.utils.object.get(i, String(element.path));
            const types = element.format ? element.format(value) : terminal.text.type(value);
            const content =
              " ".repeat(PADDING) +
              (selectedRow === rowIndex && selectedCell === colIndex
                ? chalk.inverse(types)
                : types);
            const cell = ansiPadEnd(content, columns[colIndex].maxWidth);
            const append =
              colIndex === columns.length - ARRAY_OFFSET ? TABLE_PARTS.right : TABLE_PARTS.middle;
            return cell + append;
          }),
        ].join("");
      }),
    );
  }

  function selectRange(entries: string[]): string[] {
    // This probably needs a refactor
    if (entries.length <= config.terminal.PAGE_SIZE) {
      return entries;
    }
    let preMessage = `${selectedRow - BUFFER_SIZE} before`;
    let postMessage = `${
      values.length - selectedRow - Math.floor(config.terminal.PAGE_SIZE * HALF)
    } after`;
    let preLength = ansiMaxLength(entries) - preMessage.length - EXTRA;
    let postLength = ansiMaxLength(entries) - postMessage.length - EXTRA;
    // <Top end of range>
    if (selectedRow <= BUFFER_SIZE + SINGLE) {
      const selected = entries.slice(START, config.terminal.PAGE_SIZE - SINGLE);
      postMessage = `${entries.length - selected.length} after`;
      postLength = ansiMaxLength(entries) - postMessage.length - EXTRA;
      postMessage = [
        TABLE_PARTS.left,
        postMessage
          .padStart(postLength * HALF + postMessage.length, " ")
          .padEnd(postLength + postMessage.length, " ")
          .replace(` ${postMessage} `, chalk.bgCyan.black(` ${postMessage} `)),
        TABLE_PARTS.right,
      ].join("");
      return [...selected, postMessage];
    }
    // </Top end of range>
    // <Bottom end of range>
    if (selectedRow >= entries.length - config.terminal.PAGE_SIZE + BUFFER_SIZE + SINGLE) {
      const selected = entries.slice(entries.length - config.terminal.PAGE_SIZE + PADDING);
      preMessage = `${entries.length - selected.length} before`;
      preLength = ansiMaxLength(entries) - preMessage.length - EXTRA;
      preMessage = [
        TABLE_PARTS.left,
        preMessage
          .padStart(preLength * HALF + preMessage.length, " ")
          .padEnd(preLength + preMessage.length, " ")
          .replace(` ${preMessage} `, chalk.bgCyan.black(` ${preMessage} `)),
        TABLE_PARTS.right,
      ].join("");
      return [preMessage, ...selected];
    }
    // </Bottom end of range>
    // <Middle of range>
    const out = entries.slice(
      selectedRow - BUFFER_SIZE,
      config.terminal.PAGE_SIZE + selectedRow - BUFFER_SIZE - EXTRA,
    );
    preMessage = [
      TABLE_PARTS.left,
      preMessage
        .padStart(preLength * HALF + preMessage.length, " ")
        .padEnd(preLength + preMessage.length, " ")
        .replace(` ${preMessage} `, chalk.bgCyan.black(` ${preMessage} `)),
      TABLE_PARTS.right,
    ].join("");
    postMessage = [
      TABLE_PARTS.left,
      postMessage
        .padStart(postLength * HALF + postMessage.length, " ")
        .padEnd(postLength + postMessage.length, " ")
        .replace(` ${postMessage} `, chalk.bgCyan.black(` ${postMessage} `)),
      TABLE_PARTS.right,
    ].join("");
    return [preMessage, ...out, postMessage];
    // </Middle of range>
  }

  function tableHeader(): string[] {
    return [
      [
        TABLE_PARTS.top_left,
        columns.map(i => TABLE_PARTS.top.repeat(i.maxWidth)).join(TABLE_PARTS.top_mid),
        TABLE_PARTS.top_right,
      ].join(``),
      [
        TABLE_PARTS.left,
        columns.map(i => NAME_CELL(i)).join(TABLE_PARTS.middle),
        TABLE_PARTS.right,
      ].join(""),
      [
        TABLE_PARTS.left_mid,
        columns.map(i => TABLE_PARTS.mid.repeat(i.maxWidth)).join(TABLE_PARTS.mid_mid),
        TABLE_PARTS.right_mid,
      ].join(""),
    ];
  }
  return {
    renderTable(
      options: ObjectBuilderOptions<VALUE>,
      renderRows: VALUE[],
      row: number = START,
      cell: number = START,
    ): string {
      let emptyMessage = "No rows";
      selectedCell = row;
      selectedRow = cell;
      activeOptions = options;
      values = renderRows;
      calcColumns(values);
      const header = tableHeader();
      const r = rows();
      const middle_bar = [
        TABLE_PARTS.left_mid,
        columns.map(i => TABLE_PARTS.bottom.repeat(i.maxWidth)).join(TABLE_PARTS.mid_mid),
        TABLE_PARTS.right_mid,
      ].join("");
      if (is.empty(r)) {
        const [top, content] = header;
        if (!is.empty(emptyMessage)) {
          const length = ansiMaxLength(top) - emptyMessage.length - PADDING - PADDING;
          emptyMessage = [
            TABLE_PARTS.left,
            emptyMessage
              .padStart(length * HALF + emptyMessage.length, " ")
              .padEnd(length + emptyMessage.length, " ")
              .replace(` ${emptyMessage} `, chalk.yellow.inverse(` ${emptyMessage} `)),
            TABLE_PARTS.right,
          ].join("");
          return [
            top,
            content,
            [
              TABLE_PARTS.left_mid,
              columns.map(i => TABLE_PARTS.mid.repeat(i.maxWidth)).join(TABLE_PARTS.bottom_mid),
              TABLE_PARTS.right_mid,
            ].join(""),
            emptyMessage,
            footer(TABLE_PARTS.bottom),
          ].join(`\n`);
        }
        return [top, content, footer()].join(`\n`);
      }
      return [...header, r.join(`\n${middle_bar}\n`), footer()].join(`\n`);
    },
  };
}
