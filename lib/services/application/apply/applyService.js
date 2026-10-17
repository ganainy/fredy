/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import path from 'node:path';
import { launchBrowser, closeBrowser } from '../../extractor/puppeteerExtractor.js';
import { computeDbPath } from '../../storage/SqliteConnection.js';
import { getSettings, getUserSettings } from '../../storage/settingsStorage.js';
import { buildApplicationLetter, APPLICANT_PROFILE_SETTING } from '../applicationService.js';
import { getFormMap } from './formMaps/index.js';
import { buildContactFormValues } from './values.js';
import { fillForm, clickButtonContaining } from './formFiller.js';
import { createSession, getSession, endSession } from './applySessionStore.js';
import logger from '../../logger.js';

/**
 * The browser-automation half of applying: open the real listing in a window the user can see,
 * fill in what Fredy already knows, and leave the "Senden" button to them.
 *
 * Nothing here ever submits the form. The whole feature exists because the alternative - a human
 * repeating name, email, address and household size into contact form after contact form - is
 * tedious in a way that filling it in and leaving the actual decision to send it to a human is not;
 * see the carry-over plan this module implements for the session that motivated it.
 */

/**
 * Best-effort decline of a cookie-consent banner.
 *
 * Usercentrics - the consent manager behind most German real-estate portals, including the ones
 * this feature targets - sometimes needs a first click into "Einstellungen" before "Alles
 * ablehnen" is on screen at all. Trying both costs nothing on a page that shows the plain button
 * directly, and a banner that cannot be found is left alone rather than retried forever.
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<void>}
 */
async function declineCookies(page) {
  try {
    const openedSettings = await clickButtonContaining(page, ['einstellungen']);
    if (openedSettings) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await clickButtonContaining(page, ['alles ablehnen', 'ablehnen', 'nur notwendige']);
  } catch (error) {
    logger.warn('Apply automation: could not interact with the cookie banner.', error);
  }
}

/**
 * @typedef {Object} ApplyOutcome
 * @property {true} ok
 * @property {string} sessionId - Passed back to {@link confirmApplication}.
 * @property {string[]} filled - Field keys that were filled in.
 * @property {string[]} missing - Field keys the form map wanted but the page did not have, or that
 *   could not be filled; left for the human to finish in the open window.
 */

/**
 * @typedef {{ok: false, reason: 'unsupportedProvider'|'paywalled'|'launchFailed'}} ApplyFailure
 */

/**
 * Opens the real listing in a visible browser window and fills in its contact form.
 *
 * The browser is deliberately headful - this is the one Puppeteer flow in Fredy a human is meant
 * to see and finish by hand, unlike the headless scraping `puppeteerExtractor.js` otherwise does -
 * and it is kept open under `sessionId` until {@link confirmApplication} closes it, so the user can
 * take as long as they need to review the letter and click the portal's own send button.
 *
 * @param {Object} listing - A row as `getListingById` returns it; needs at least `id`, `link` and
 *   `provider`.
 * @param {string} userId
 * @returns {Promise<ApplyOutcome|ApplyFailure>}
 */
export async function startApplication(listing, userId) {
  const formMap = getFormMap(listing?.provider);
  if (formMap == null) {
    return { ok: false, reason: 'unsupportedProvider' };
  }

  const userSettings = getUserSettings(userId) ?? {};
  const profile = userSettings[APPLICANT_PROFILE_SETTING] ?? null;
  const letter = await buildApplicationLetter(listing, userId);
  const values = buildContactFormValues(profile, letter.text);

  const settings = await getSettings();
  let browser;
  try {
    // A persistent profile, in the one directory Fredy already asks operators to persist (the
    // database volume) - see the carry-over plan's ImmoScout24 gotcha: the portal remembers a
    // previous listing's field values in client-side state keyed to the browser profile, which
    // only a profile that survives between applications can reproduce (and benefit from - cookie
    // consent decided once is decided for every later application too).
    const { dir } = await computeDbPath();
    browser = await launchBrowser(listing.link, {
      puppeteerHeadless: false,
      proxyUrl: settings?.proxyUrl,
      userDataDir: path.join(dir, 'apply-browser-profile'),
    });
  } catch (error) {
    logger.warn('Apply automation: could not launch the browser.', error);
    return { ok: false, reason: 'launchFailed' };
  }

  let page;
  try {
    page = await browser.newPage();
    await page.goto(listing.link, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    if (formMap.isPaywalled(page.url())) {
      await closeBrowser(browser);
      return { ok: false, reason: 'paywalled' };
    }

    await declineCookies(page);
    await clickButtonContaining(page, formMap.openPhrases);

    const { filled, missing } = await fillForm(page, formMap.fields, values);

    const sessionId = await createSession({ browser, page, listingId: listing.id, userId });
    return { ok: true, sessionId, filled, missing };
  } catch (error) {
    logger.warn('Apply automation: could not fill in the contact form.', error);
    await closeBrowser(browser);
    return { ok: false, reason: 'launchFailed' };
  }
}

/**
 * Ends an apply session: closes the browser window, whatever the user did inside it.
 *
 * Fredy has no way to know whether the user actually pressed the portal's own "Senden" - the two
 * are different origins, and nothing short of that would be worth the privacy cost of trying to
 * find out. Recording the listing as applied for is therefore the caller's decision, made by
 * clicking "Mark as sent" in Fredy's own UI; this function only ever closes the window.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @returns {Promise<boolean>} Whether a session was found and closed.
 */
export async function confirmApplication(sessionId, userId) {
  const session = await getSession(sessionId, userId);
  if (session == null) {
    return false;
  }
  await endSession(sessionId);
  return true;
}
