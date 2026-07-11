// Derives the set of all i18n keys from the English dictionary so zh.ts
// can use `satisfies Record<keyof TranslationKeys, string>` for
// compile-time alignment — adding a key to en without a matching entry
// in zh becomes a type error.

import type { en } from "./en";
export type TranslationKeys = typeof en;
