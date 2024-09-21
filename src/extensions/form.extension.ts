import {
  ARRAY_OFFSET,
  INCREMENT,
  is,
  LABEL,
  START,
  TServiceParams,
  VALUE,
} from "@digital-alchemy/core";

import { ObjectBuilderOptions, TableBuilderElement } from "../helpers";
import { ansiMaxLength, ansiStrip, ELLIPSES } from "../includes";
import { TABLE_PARTS } from ".";

const PADDING = 1;
const DOUBLE_PADDING = 2;
const TRIPLE_PADDING = 3;
const PARTS_AND_PADDING = 7;

function ellipsis(value: string, maxLength: number): string {
  const stripped = ansiStrip(value);
  const length = ansiMaxLength(...stripped.split(`\n`));
  const max = maxLength - ELLIPSES.length;
  if (length > maxLength) {
    const update = stripped.slice(START, max) + ELLIPSES;
    value = value.replace(stripped, update);
  }
  return value;
}

export function Form({ terminal, internal }: TServiceParams) {
  const { chalk, ansiPadEnd, GV, template } = terminal.internals;
  let selectedRow: number;

  function formBody<VALUE extends object = Record<string, unknown>, CANCEL extends unknown = never>(
    value: VALUE,
    activeOptions: ObjectBuilderOptions<VALUE, CANCEL>,
    maxLabel: number,
    original: VALUE,
  ): string[] {
    function getRenderValue(element: TableBuilderElement<VALUE>): unknown {
      const raw = internal.utils.object.get(value, element.path) as unknown[];
      if (element.type === "pick-one") {
        const option = element.options.find(({ entry }) => entry[VALUE] === raw);
        if (option) {
          return option.entry[LABEL];
        }
      }
      if (element.type === "pick-many") {
        if (!is.array(raw)) {
          return raw;
        }
        return raw.map(item => {
          const option = element.options.find(i => GV(i) === item);
          if (!option) {
            return item;
          }
          return option?.entry[LABEL];
        });
      }
      return raw;
    }

    function maxValueLength(maxLabel: number) {
      return Math.min(
        terminal.environment.getWidth() -
          maxLabel -
          PARTS_AND_PADDING -
          // both sides padding
          DOUBLE_PADDING -
          DOUBLE_PADDING,
        DOUBLE_PADDING +
          ansiMaxLength(
            ...activeOptions.elements.map(i => {
              return terminal.text.type(getRenderValue(i));
            }),
          ),
      );
    }

    function nameCell(i: TableBuilderElement<VALUE>, color: "blue" | "green", max?: number) {
      return template(`${" ".repeat(PADDING)}{bold.${color} ${i.name.padEnd(max - PADDING, " ")}}`);
    }

    function renderValue(
      {
        i,
        index,
        maxLabel,
        maxValue,
      }: {
        i: TableBuilderElement<VALUE>;
        index: number;
        maxLabel: number;
        maxValue: number;
      },
      original: VALUE,
    ): string {
      const raw = getRenderValue(i);
      const v = terminal.text.type(raw, undefined, maxValue - INCREMENT).trim();
      const lines = v.split(`\n`).length;
      const values = (index === selectedRow ? chalk.inverse(v) : v).split(`\n`);
      const labels = (
        nameCell(
          i,
          is.equal(internal.utils.object.get(original, i.path), raw) ? "blue" : "green",
          maxLabel,
        ) + `\n`.repeat(lines - INCREMENT)
      ).split(`\n`);
      return labels
        .map((labelLine, labelIndex) => {
          return [
            TABLE_PARTS.left,
            ansiPadEnd(labelLine, maxLabel + TRIPLE_PADDING),
            TABLE_PARTS.middle,
            " " +
              ellipsis(
                // ansiPadEnd("foobar", maxValue),
                ansiPadEnd(values[labelIndex], maxValue - INCREMENT),
                maxValue,
              ),
            TABLE_PARTS.right,
          ].join("");
        })
        .join(`\n`);
    }

    const elements = activeOptions.elements;

    // ? ensure the label properly fits on the screen
    const maxValue = maxValueLength(maxLabel);
    const columns = elements.map((i: TableBuilderElement<VALUE>, index) =>
      renderValue({ i, index, maxLabel, maxValue }, original),
    );
    const header = [
      TABLE_PARTS.top_left,
      TABLE_PARTS.top.repeat(maxLabel + TRIPLE_PADDING),
      TABLE_PARTS.top_mid,
      TABLE_PARTS.top.repeat(maxValue),
      TABLE_PARTS.top_right,
    ].join(``);
    const footer = [
      TABLE_PARTS.bottom_left,
      TABLE_PARTS.top.repeat(maxLabel + TRIPLE_PADDING),
      TABLE_PARTS.bottom_mid,
      TABLE_PARTS.top.repeat(maxValue),
      TABLE_PARTS.bottom_right,
    ].join("");
    return [
      header,
      ...columns.flatMap((i, index, array) =>
        index === array.length - ARRAY_OFFSET
          ? [i]
          : [
              i,
              [
                TABLE_PARTS.left_mid,
                TABLE_PARTS.mid.repeat(maxLabel + TRIPLE_PADDING),
                TABLE_PARTS.mid_mid,
                TABLE_PARTS.mid.repeat(maxValue),
                TABLE_PARTS.right_mid,
              ].join(``),
            ],
      ),
      footer,
    ];
  }

  return {
    renderForm<VALUE extends object = Record<string, unknown>, CANCEL extends unknown = never>(
      options: ObjectBuilderOptions<VALUE, CANCEL>,
      row: VALUE,
      original: VALUE,
      targetRow: number = START,
    ): string {
      selectedRow = targetRow;
      const maxLength = ansiMaxLength(...options.elements.map(({ name }) => name));
      const header = formBody(row, options, maxLength, original);
      return [...header].join(`\n`);
    },
  };
}
