// Opens the Calendar as a user whose language is French and writes what the
// <calendar-portlet> element shows and logs.
//
//   node calendar-french.mjs <label> <out directory>     (from the uPortal-start clone)
//
// The user is student. The script chooses French in the User Locales Selector portlet, as a
// user would, opens the Calendar in its narrow view (window state normal) and its wide view
// (maximized), and chooses English again. With the label "after" it exits 1 unless both views
// show the French labels and the element logs no error.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const [label, out] = process.argv.slice(2);
const portal = "http://localhost:8080/uPortal/";
const views = {
  narrow: `${portal}p/calendar/normal/render.uP`,
  wide: `${portal}p/calendar/max/render.uP`,
};
const french = { buttons: ["Jour", "Semaine", "Mois"], more: "Voir plus d'évènements" };

async function chooseLanguage(page, code) {
  await page.goto(`${portal}p/user-locales-selector/max/render.uP`);
  await page.locator(`input[type=radio][value=${code}]`).check();
  await Promise.all([
    page.waitForNavigation(),
    page.locator("input[name=_eventId_updateLocale]").click(),
  ]);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().split("\n")[0]);
});
const result = { label, views: {}, problems: [] };
try {
  await page.goto(`${portal}Login?userName=student&password=student`);
  await chooseLanguage(page, "fr_FR");
  result["html lang after choosing French"] = await page.locator("html").getAttribute("lang");
  for (const [view, url] of Object.entries(views)) {
    consoleErrors.length = 0;
    await page.goto(url);
    const calendar = page.locator("calendar-portlet").first();
    await calendar.locator(".upcal-range-day").first().waitFor({ timeout: 60000 });
    const seen = {
      "container class": await page
        .locator(".upcal-narrowview, .upcal-wideview")
        .first()
        .getAttribute("class"),
      buttons: await calendar.locator(".upcal-range-day").allTextContents(),
      "view more events link": await calendar
        .locator(".upcal-view-more-events")
        .allTextContents()
        .then((texts) => texts.map((text) => text.trim())),
      "console errors from calendar-portlet": consoleErrors.filter((text) =>
        text.includes("calendar-portlet"),
      ),
    };
    result.views[view] = seen;
    if (!seen["container class"].includes(`upcal-${view}view`)) {
      result.problems.push(`${view}: the page shows the other view`);
    }
    if (seen.buttons.join() !== french.buttons.join()) {
      result.problems.push(`${view}: the buttons aren't French`);
    }
    if (view === "narrow" && seen["view more events link"].join() !== french.more) {
      result.problems.push("narrow: the link isn't French");
    }
    if (seen["console errors from calendar-portlet"].length > 0) {
      result.problems.push(`${view}: the element logged an error`);
    }
    await page.screenshot({ path: `${out}/calendar-${label}-${view}.png` });
  }
} catch (error) {
  result.problems.push(`the check stopped: ${String(error).split("\n")[0]}`);
} finally {
  await chooseLanguage(page, "en_US").catch(() => {});
  await browser.close();
}
writeFileSync(`${out}/check-${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(label === "after" && result.problems.length > 0 ? 1 : 0);
