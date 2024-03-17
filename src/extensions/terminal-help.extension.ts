import {
  AnyConfig,
  BaseConfig,
  BooleanConfig,
  DOWN,
  EMPTY,
  INCREMENT,
  is,
  NumberConfig,
  StringConfig,
  TServiceParams,
  UP,
} from "@digital-alchemy/core";
import { exit } from "process";

import { ansiMaxLength } from "../includes";

function formatDescription(prefix: string, description: string | string[]) {
  description ||= "No description";
  const size = ansiMaxLength(prefix);
  return (
    prefix +
    [description]
      .flat()
      .map(i =>
        i
          .split(". ")
          .map((line, index) =>
            index === EMPTY ? line : " ".repeat(size) + line,
          )
          .join(`.\n`),
      )
      .join("\n")
  );
}

export function TerminalHelp({
  terminal,
  lifecycle,
  config,
  internal,
}: TServiceParams) {
  const { chalk } = terminal.internals;

  lifecycle.onPostConfig(() => {
    if (!config.terminal.HELP) {
      return;
    }
    terminal.application.setHeader("Help");
    const ALL_SWITCHES: string[] = [];

    const configDefinitions =
      internal.boilerplate.configuration.getDefinitions();

    configDefinitions.forEach(configuration =>
      ALL_SWITCHES.push(
        ...Object.entries(configuration).map(([property]) => property),
      ),
    );
    terminal.screen.down();
    const LONGEST =
      Math.max(...ALL_SWITCHES.map(line => line.length)) + INCREMENT;
    configDefinitions.forEach((configuration, project) => {
      printProject(project, configuration, LONGEST);
    });
    exit();
  });

  function printProject(
    project: string,
    configuration: Record<string, AnyConfig>,
    LONGEST: number,
  ) {
    terminal.screen.printLine(
      chalk`Provided by {magenta.bold ${internal.utils.TitleCase(project)}}`,
    );
    Object.entries(configuration)
      .sort(([a], [b]) => (a > b ? UP : DOWN))
      .forEach(([property, config]) => {
        property = property
          .replaceAll("-", "_")
          .toLocaleLowerCase()
          .padEnd(LONGEST, " ");
        switch (config.type) {
          case "number": {
            numberSwitch(property, config as NumberConfig);
            break;
          }
          case "string": {
            stringSwitch(property, config as StringConfig<string>);
            break;
          }
          case "boolean": {
            booleanSwitch(property, config as BooleanConfig);
            break;
          }
          default:
            return;
            otherSwitch(property, config);
        }
        terminal.screen.down();
      });
  }

  function booleanSwitch(property: string, config: BooleanConfig): void {
    const prefix = chalk`  {${
      config.required ? "red.bold" : "white"
    } --${property}} {gray [{bold boolean}}${
      is.undefined(config.default as boolean)
        ? ""
        : chalk`, {gray default}: {bold.green ${config.default}}`
    }{gray ]} `;
    terminal.screen.printLine(formatDescription(prefix, config.description));
  }

  function numberSwitch(property: string, config: NumberConfig): void {
    const prefix = chalk`  {${
      config.required ? "red.bold" : "white"
    } --${property}} {gray [{bold number}}${
      is.undefined(config.default as number)
        ? ""
        : chalk`, {gray default}: {bold.yellow ${config.default}}`
    }{gray ]} `;
    terminal.screen.printLine(formatDescription(prefix, config.description));
  }

  function otherSwitch(property: string, config: BaseConfig) {
    const prefix = chalk`  {${
      config.required ? "red.bold" : "white"
    } --${property}} {gray [other}${
      is.undefined(config.default)
        ? ""
        : chalk`, {gray default}: {bold.magenta ${JSON.stringify(
            config.default,
          )}}`
    }{gray ]} `;
    terminal.screen.printLine(formatDescription(prefix, config.description));
  }

  function stringSwitch(property: string, config: StringConfig<string>): void {
    let enums = "";
    if (is.empty(config.enum)) {
      const enumList = config.enum
        .map(item => chalk.blue(item))
        .join(chalk("{yellow.dim  | }"));
      enums = chalk`{gray , enum}: ${enumList}`;
    }

    const defaultValue = is.empty(config.default)
      ? ""
      : chalk`, {gray default}: {bold.blue ${config.default}}`;

    const color = config.required ? "red.bold" : "white";

    const prefix = chalk`  {${color} --${property}} {gray [{bold string}}${defaultValue}${enums}{gray ]} `;
    terminal.screen.printLine(formatDescription(prefix, config.description));
  }
}
