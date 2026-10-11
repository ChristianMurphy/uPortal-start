import { test, expect } from "@playwright/test";
import { accent, pseudoMessage, pseudoMessages } from "./pseudo-locales";

/* The pseudo-locale transform itself; no portal needed */

test("accents every ASCII letter", () => {
  expect(accent("Try again 2x")).toBe("Ţŕý áĝáíñ 2ẋ");
});

test("en-XA brackets the text and makes it about 40% longer", () => {
  const message = pseudoMessage("Filters", "en-XA");
  expect(message).toBe("[Ƒíļţéŕš ··]");
  const long = "Your session has expired. Sign in again to see your favorites.";
  const pseudo = pseudoMessage(long, "en-XA");
  expect(pseudo.length).toBeGreaterThanOrEqual(Math.ceil(long.length * 1.4));
  expect(pseudo.startsWith("[") && pseudo.endsWith("]")).toBe(true);
});

test("ar-XB writes the text right to left inside the brackets", () => {
  expect(pseudoMessage("Next", "ar-XB")).toBe("[‮Ñéẋţ ·‬]");
});

test("keeps placeholders, doubled apostrophes, tags and entities", () => {
  expect(pseudoMessage("Move {0} to {1,number} of {2}", "en-XA")).toBe(
    "[Ṁóṽé {0} ţó {1,number} óƒ {2} ·····]",
  );
  expect(
    pseudoMessage("Maybe you''d like to <a href=\"{0}\">visit</a>", "en-XA"),
  ).toContain("''ð ļíķé ţó <a href=\"{0}\">ṽíšíţ</a>");
  expect(pseudoMessage("&lt; Previous", "en-XA")).toBe("[&lt; Þŕéṽíóúš ···]");
  expect(pseudoMessage("", "en-XA")).toBe("");
});

test("transforms each message of a bundle", () => {
  expect(pseudoMessages({ a: "Title", b: "Next" }, "en-XA")).toEqual({
    a: "[Ţíţļé ·]",
    b: "[Ñéẋţ ·]",
  });
});
