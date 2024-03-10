import { CreateLibrary, StringConfig } from "@digital-alchemy/core";
import { Fonts } from "figlet";

import {
  AcknowledgeComponent,
  ApplicationManager,
  ArrayBuilder,
  Colors,
  ComparisonTools,
  ConfirmComponent,
  DateEditor,
  Environment,
  Form,
  IconExtension,
  Internals,
  KeyboardManager,
  KeyMapExtension,
  Menu,
  NumberEditor,
  ObjectBuilder,
  PickMany,
  Prompts,
  Registry,
  Screen,
  StringEditor,
  TerminalHelp,
  TextRendering,
} from "./extensions";

export const LIB_TERMINAL = CreateLibrary({
  configuration: {
    APPLICATION_PADDING_LEFT: {
      default: 2,
      description: "Automatic offsets for header. POC / deprecated",
      type: "number",
    },
    APPLICATION_PADDING_TOP: {
      default: 1,
      description: "Automatic offsets for header. POC / deprecated",
      type: "number",
    },
    DEFAULT_ACKNOWLEDGE_MESSAGE: {
      default: "Any key to continue",
      type: "string",
    },
    DEFAULT_PROMPT_WIDTH: {
      default: 50,
      description: "Box width for prompts short text inputs",
      type: "number",
    },
    FUZZY_HIGHLIGHT: {
      default: "red.bold.underline",
      description: "Chalk highlighting to apply to fuzzy search",
      type: "string",
    },
    HEADER_COLOR_PRIMARY: {
      default: "cyan",
      type: "string",
    },
    HEADER_COLOR_SECONDARY: {
      default: "magenta",
      type: "string",
    },
    HEADER_FONT_PRIMARY: {
      default: "ANSI Regular",
      description: "Figlet font",
      type: "string",
    } as StringConfig<Fonts>,
    HEADER_FONT_SECONDARY: {
      default: "Pagga",
      description: "Figlet font",
      type: "string",
    } as StringConfig<Fonts>,
    HELP: {
      default: false,
      description:
        "Intended for consumption as cli switch (--help). Performs early abort and prints available cli switches to console",
      type: "boolean",
    },
    HELP_DIVIDER: {
      default: "blue.dim",
      type: "string",
    },
    KEYMAP_TICK: {
      default: `{blue.dim > }`,
      // default: `{blue.dim ${FontAwesomeIcons.caret_right} }`,
      type: "string",
    },
    MENU_COLUMN_DIVIDER: {
      default: "{blue.dim |}",
      type: "string",
    },
    MENU_ENTRY_NORMAL: {
      default: "white",
      type: "string",
    },
    MENU_ENTRY_OTHER: {
      default: "gray",
      type: "string",
    },
    MENU_ENTRY_SELECTED: {
      default: "bgBlueBright.black",
      type: "string",
    },
    MENU_ENTRY_TYPE: {
      default: "magenta.bold",
      type: "string",
    },
    MENU_ENTRY_TYPE_OTHER: {
      default: "gray.bold",
      type: "string",
    },
    MENU_SEARCHBOX_CONTENT: {
      default: "bgCyan",
      type: "string",
    },
    MENU_SEARCHBOX_EMPTY: {
      default: "bgBlue",
      type: "string",
    },
    MENU_SEARCHBOX_NORMAL: {
      default: "bgMagenta",
      type: "string",
    },
    PAGE_SIZE: {
      default: 20,
      description: "Item quantity in menus / lists",
      type: "number",
    },
    PROMPT_QUESTION: {
      default: `{blue ?}`,
      // default: `{blue ${FontAwesomeIcons.question}}`,
      type: "string",
    },
    STRING_EDITOR_CONTENT: {
      default: "bgWhite",
      type: "string",
    },
    STRING_EDITOR_EMPTY: {
      default: "bgBlue",
      type: "string",
    },
    TABLE_RENDER_ROWS: {
      default: 20,
      description:
        "Default quantity of rows to render in prompts like arrayBuilder",
      type: "number",
    },
    TEXT_DEBUG_ARRAY_LENGTH: {
      default: 2,
      description: "Util.inspect array length",
      type: "number",
    },
    TEXT_DEBUG_DEPTH: {
      default: 5,
      description: "Util.inspect object depth",
      type: "number",
    },
    USE_FONTAWESOME_ICONS: {
      default: true,
      description:
        "Utilize font awesome icons in prompts. Requires font to be installed.",
      type: "boolean",
    },
  },
  name: "terminal",
  priorityInit: ["internals", "registry"],
  services: {
    acknowledge: AcknowledgeComponent,
    application: ApplicationManager,
    array: ArrayBuilder,
    colors: Colors,
    comparison: ComparisonTools,
    confirm: ConfirmComponent,
    date: DateEditor,
    environment: Environment,
    form: Form,
    icon: IconExtension,
    internals: Internals,
    keyboard: KeyboardManager,
    keymap: KeyMapExtension,
    menu: Menu,
    number: NumberEditor,
    object: ObjectBuilder,
    pick_many: PickMany,
    prompt: Prompts,
    registry: Registry,
    screen: Screen,
    string: StringEditor,
    terminal_help: TerminalHelp,
    text: TextRendering,
  },
});

declare module "@digital-alchemy/core" {
  export interface LoadedModules {
    terminal: typeof LIB_TERMINAL;
  }
}
