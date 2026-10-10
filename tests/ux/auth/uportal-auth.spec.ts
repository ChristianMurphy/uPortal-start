import { test, expect } from "@playwright/test";
import {
  expectLoginRefused,
  expectSignedOut,
  loginViaPage,
  openLoginForm,
  submitLoginForm,
} from "../utils/ux-general-utils";
import { config } from "../../general-config";

/*
 * Runs in both authModes (docs/authentication.md):  the helpers drive
 * uPortal's own login form, or the CAS server's when AUTH_MODE=cas.
 */

const SEL_UPORTAL_LOGOUT = ".portal-logout";

test("Sign In opens the login form of the portal's authMode", async ({
  page,
}) => {
  await page.goto(`${config.url}f/welcome/normal/render.uP`);
  await openLoginForm(page);
});

test("login, logout, login as different user", async ({ page }) => {
  // Login as admin
  await loginViaPage(page, config.users.admin);

  // Logout via UX
  const uportalSignout = page.locator(SEL_UPORTAL_LOGOUT);
  await expect(uportalSignout).toHaveText("Sign Out");
  await expect(uportalSignout).toHaveAttribute("href", "/uPortal/Logout");
  await page.click(SEL_UPORTAL_LOGOUT);

  // Back on the guest page; with CAS, by way of CAS's logout
  await expectSignedOut(page);

  // Login as student:  with CAS this also shows the single sign-on session
  // ended, or CAS would have skipped its form and signed admin back in
  await loginViaPage(page, config.users.student);
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto(`${config.url}f/welcome/normal/render.uP`);
  await openLoginForm(page);
  await submitLoginForm(
    page,
    config.users.student.username,
    `${config.users.student.password}-wrong`
  );
  await expectLoginRefused(page);

  // Still a guest
  await page.goto(`${config.url}f/welcome/normal/render.uP`);
  await expectSignedOut(page);
});
