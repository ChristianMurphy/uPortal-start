/*
 * Pseudo-locales (MOD-D51): English text turned into two test-only
 * "languages", so a test finds what a real translation would break without
 * a translator. They are built at test time and never shipped.
 *
 * - en-XA, accented: every letter carries an accent, the text is about 40%
 *   longer (as German and Finnish often are) and sits in [brackets]. Visible
 *   text without brackets was not translated: it is English written into the
 *   code, or data. Text cut off by its box shows a missing closing bracket.
 * - ar-XB, right to left: the brackets and the 40%, with the text between
 *   RIGHT-TO-LEFT OVERRIDE and POP DIRECTIONAL FORMATTING, so it reads
 *   backwards like a right-to-left script. Its language is Arabic, so a
 *   component sets dir="rtl" and its layout must mirror.
 *
 * Placeholders ({0}, {1,number}), MessageFormat's doubled apostrophes (''),
 * HTML tags and entities pass through unchanged, so a pseudo message formats
 * as the English one does.
 */

export type PseudoLocale = "en-XA" | "ar-XB";

export const PSEUDO_LOCALES: readonly PseudoLocale[] = ["en-XA", "ar-XB"];

const ACCENTED: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "ǫ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Á",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "É",
  F: "Ƒ",
  G: "Ĝ",
  H: "Ĥ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ļ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ó",
  P: "Þ",
  Q: "Ǫ",
  R: "Ŕ",
  S: "Š",
  T: "Ţ",
  U: "Ú",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};

/** The end of a protected part starting at `index`, or -1 when there is none. */
function protectedEnd(message: string, index: number): number {
  const char = message.charAt(index);
  if (char === "'" && message.charAt(index + 1) === "'") return index + 2;
  // A placeholder ({0}, {1,number}), a tag (<a href="{0}">), an entity (&lt;)
  const close = { "{": "}", "<": ">", "&": ";" }[char];
  if (close === undefined) return -1;
  const end = message.indexOf(close, index + 1);
  if (end === -1) return -1;
  if (char === "&" && !/^#?[\dA-Za-z]+$/.test(message.slice(index + 1, end))) {
    return -1;
  }
  return end + 1;
}

/**
 * The message cut into text and protected parts: placeholders, MessageFormat's
 * doubled apostrophes, HTML tags and entities.
 */
function parts(message: string): { text: string; kept: boolean }[] {
  const result: { text: string; kept: boolean }[] = [];
  let text = "";
  let index = 0;
  while (index < message.length) {
    const end = protectedEnd(message, index);
    if (end === -1) {
      text += message.charAt(index);
      index += 1;
    } else {
      if (text !== "") result.push({ text, kept: false });
      text = "";
      result.push({ text: message.slice(index, end), kept: true });
      index = end;
    }
  }
  if (text !== "") result.push({ text, kept: false });
  return result;
}

const RLO = "‮";
const PDF = "‬";

/** The text with an accent on every ASCII letter. */
export function accent(text: string): string {
  return [...text].map((char) => ACCENTED[char] ?? char).join("");
}

/** Filler that makes text of `length` characters about 40% longer. */
function padding(length: number): string {
  const extra = Math.ceil(length * 0.4);
  return extra === 0 ? "" : ` ${"·".repeat(Math.max(1, extra - 1))}`;
}

/** One English message in a pseudo-locale. */
export function pseudoMessage(message: string, locale: PseudoLocale): string {
  if (message.trim() === "") {
    return message;
  }
  let letters = 0;
  const body = parts(message)
    .map((part) => {
      if (part.kept) return part.text;
      letters += part.text.length;
      return accent(part.text);
    })
    .join("");
  const text = `${body}${padding(letters)}`;
  return locale === "ar-XB" ? `[${RLO}${text}${PDF}]` : `[${text}]`;
}

/** Every message of a bundle in a pseudo-locale. */
export function pseudoMessages(
  messages: Readonly<Record<string, string>>,
  locale: PseudoLocale,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      pseudoMessage(value, locale),
    ]),
  );
}
