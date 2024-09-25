import { deepExtend, is, START, TServiceParams } from "@digital-alchemy/core";
import chalk from "chalk";

import { ArrayBuilderOptions, KeyMap, MainMenuCB, MainMenuEntry, MenuEntry } from "../../helpers";
import { ComponentDoneCallback } from "..";

type TypeToggle = { type: string };

export function ArrayBuilder<VALUE extends object>({ terminal, internal }: TServiceParams) {
  let complete = false;
  let disabledTypes: string[] = [];
  let done: ComponentDoneCallback<VALUE>;
  let final = false;
  let options: ArrayBuilderOptions<VALUE>;
  let rows: VALUE[];
  let selectedRow: number;

  function header(): void {
    const message = options.header;
    if (is.string(message)) {
      terminal.application.setHeader(message);
      return;
    }
    const [a, b] = message;
    terminal.application.setHeader(a, b);
  }

  async function objectBuild<CANCEL = symbol>(
    current: VALUE,
    cancel?: CANCEL,
  ): Promise<VALUE | CANCEL> {
    const { elements, headerMessage, helpNotes, sanitize, validate } = options;
    return await terminal.prompt.objectBuilder<VALUE, CANCEL>({
      async cancel({ dirtyProperties, cancelFunction, confirm }) {
        if (is.empty(dirtyProperties)) {
          cancelFunction(cancel);
          return;
        }
        const status = await confirm("Are you sure you want to discard changes?");
        if (status) {
          cancelFunction(cancel);
        }
      },
      current,
      elements,
      headerMessage,
      helpNotes,
      sanitize,
      validate,
    });
  }
  const component = terminal.registry.registerComponent("array", {
    configure(options: ArrayBuilderOptions<VALUE>, onDone: ComponentDoneCallback<VALUE>): void {
      rows = deepExtend([], options.current ?? []);
      selectedRow = START;
      disabledTypes = [];
      options = options;
      complete = false;
      final = false;
      done = onDone;
      options.cancelMessage ??= "Are you sure you want to cancel building this object?";
      options.header ??= "Array builder";
      options.valuesLabel ??= "Values";
    },

    onEnd() {
      if (!done) {
        return;
      }
      final = true;
      done(rows);
      component.render();
      done = undefined;
    },

    // eslint-disable-next-line sonarjs/cognitive-complexity
    async render(): Promise<void> {
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
        // return renderFinal();
      }
      header();
      const keyMapExtras: KeyMap = {};
      type ValueToggle = { value: VALUE };
      type MenuResult = ValueToggle | TypeToggle | string;
      const right: MainMenuEntry<MenuResult>[] = [];
      let toggles: MainMenuEntry<TypeToggle>[] = [];
      if (!is.empty(rows)) {
        keyMapExtras.r = {
          entry: [chalk.blue.dim("remove row"), "remove"],
        };
        keyMapExtras.e = {
          entry: [chalk.blue.dim("edit"), "edit"],
        };

        if (!is.empty(options.typePath)) {
          toggles = is
            .unique(rows.map(row => String(internal.utils.object.get(row, options.typePath))))
            .map((type: string) => {
              return {
                entry: [type, { type }],
                icon: terminal.icon.getIcon(
                  disabledTypes.includes(type) ? "toggle_off" : "toggle_on",
                ),
                type: "Show Group",
              } as MainMenuEntry<TypeToggle>;
            });
          right.push(...toggles);
          keyMapExtras["["] = {
            entry: [chalk.blue.dim("toggle on all types"), "toggle_on"],
          };
          keyMapExtras["]"] = {
            entry: [chalk.blue.dim("toggle off all types"), "toggle_off"],
          };
          keyMapExtras.t = {
            entry: [chalk.blue.dim("toggle selected type"), "toggle"],
          };
        }
      }

      // Current list of rows
      const left = rows
        .map(row => {
          return {
            entry: [internal.utils.object.get(row, String(options.labelPath)), { value: row }],
            // Maybe one day dot notation will actually be relevant to this
            type: is.empty(options.typePath)
              ? undefined
              : String(internal.utils.object.get(row, options.typePath)),
          } as MainMenuEntry<{ value: VALUE }>;
        })
        .filter(({ type }) => !disabledTypes.includes(type));

      let typeToggle: TypeToggle;
      let valueRemove: ValueToggle;
      const keyMapCallback = ((action: string, [, value]: MenuEntry<VALUE>) => {
        switch (action) {
          case "toggle": {
            if (is.object(value) && !is.undefined((value as TypeToggle).type)) {
              typeToggle = value as TypeToggle;
              return true;
            }
            return chalk`Can only use toggle on {magenta.bold Show Group} entries.`;
          }
          case "remove": {
            if (is.object(value) && !is.undefined((value as ValueToggle).value)) {
              valueRemove = value as ValueToggle;
              return true;
            }
            return chalk`Can only use on values in the {bold.blue ${options.valuesLabel}} entries`;
          }
        }
        return true;
      }) as MainMenuCB<MenuResult>;

      let result = await terminal.prompt.menu<MenuResult>({
        emptyMessage: chalk` {yellow.bold.inverse  No items in array }`,
        keyMap: {
          "+": {
            alias: ["a"],
            entry: [chalk.blue.dim("add row"), "add"],
          },
          escape: ["done"],
          ...keyMapExtras,
        },
        keyMapCallback: keyMapCallback as MainMenuCB,
        left: is.empty(options.typePath) ? right : left,
        leftHeader: options.leftHeader ?? "Array",
        right: is.empty(options.typePath) ? left : right,
        rightHeader: options.rightHeader ?? "Actions",
      });

      if (is.object(result)) {
        if (!is.undefined((result as TypeToggle).type)) {
          typeToggle = result as TypeToggle;
          result = "toggle";
        } else if (is.undefined((result as ValueToggle).value)) {
          return;
        } else {
          // TODO: why was this assignment here?
          // result = result as ValueToggle;
          result = "edit";
        }
      }

      const cancel = Symbol();
      switch (result) {
        // done with editing, return result
        case "done": {
          component.onEnd();
          return;
        }

        // remove a row (prompt first)
        case "remove": {
          if (
            await terminal.prompt.confirm({
              label: chalk`Are you sure you want to delete {red ${internal.utils.object.get(
                rows[selectedRow],
                String(options.labelPath),
              )}}`,
            })
          ) {
            rows = rows.filter(row => row !== valueRemove.value);
          }
          return await component.render();
        }

        // create a new row
        case "add": {
          const add = await objectBuild(deepExtend({}, options.defaultRow), cancel);
          if (add !== cancel) {
            rows.push(add);
          }
          return await component.render();
        }

        // toggle visibility of a type category
        case "toggle": {
          disabledTypes = disabledTypes.includes(String(typeToggle.type))
            ? disabledTypes.filter(type => type !== String(typeToggle.type))
            : [...disabledTypes, String(typeToggle.type)];
          return await component.render();
        }

        // toggle on all type categories
        case "toggle_on": {
          disabledTypes = toggles.map(i => String(i.type));
          return await component.render();
        }

        // toggle off all type categories
        case "toggle_off": {
          disabledTypes = [];
          return await component.render();
        }

        // edit a row
        case "edit": {
          const build = await objectBuild(deepExtend({}, rows[selectedRow]), cancel);
          if (build !== cancel) {
            rows[selectedRow] = build;
          }
          return await component.render();
        }
      }
    },
  });

  return async <VALUE extends object>(options: ArrayBuilderOptions<VALUE>) =>
    await terminal.prompt.arrayBuilder(options);
}
