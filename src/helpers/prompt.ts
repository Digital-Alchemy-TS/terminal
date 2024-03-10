import { MainMenuEntry } from "./keyboard";

export type PromptMenuItems<T extends unknown = string> = {
  name: string;
  short?: string;
  value: T;
}[];

export interface PromptAcknowledgeOptions {
  label?: string;
}

export interface PromptBooleanOptions {
  current?: boolean;
  label: string;
}

export interface PromptConfirmOptions {
  current?: boolean;
  label?: string;
}

export interface PromptPasswordOptions {
  current?: string;
  label?: string;
}

export interface PromptPickOneOptions<VALUE extends unknown = string> {
  current?: string | VALUE;
  headerMessage?: string;
  options: MainMenuEntry<VALUE>[];
}

export interface PromptTimeOptions {
  current?: Date;
  label?: string;
}

export type ExternalEditorOptions = {
  /**
   * Which path to store the file
   */
  dir?: string;
  /**
   * Which mode to create the file with. e.g. 644
   */
  mode?: number;
  /**
   * A postfix for the file name. Useful if you want to provide an extension
   */
  postfix?: string;
  /**
   * A prefix for the file name.
   */
  prefix?: string;
  /**
   * Value to edit
   */
  text?: string;
  /**
   * Trim the final output
   *
   * > Default: `true`
   */
  trim?: boolean;
};

export type PROMPT_WITH_SHORT = { name: string; short: string };
export type PromptEntry<VALUE extends unknown = string> =
  | [label: string | PROMPT_WITH_SHORT, value: string | VALUE]
  | [label: string];
export type EditableSearchBoxOptions = {
  bgColor: string;
  cursor: number;
  padding?: number;
  placeholder?: string;
  value: string;
  width: number;
};
