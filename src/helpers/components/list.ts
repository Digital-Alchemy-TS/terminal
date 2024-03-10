import { MainMenuEntry } from "../keyboard";

export interface PickManyComponentOptions<VALUE = unknown> {
  current?: MainMenuEntry<VALUE | string>[];
  items?: string;
  source: MainMenuEntry<VALUE | string>[];
  titleTypes?: boolean;
}
// search?: BaseSearchOptions & {
//   /**
//    * Only applies when values are passed as objects.
//    * Fuzzy search will consider values
//    */
//   deep?: keyof VALUE | (keyof VALUE)[];
// };
