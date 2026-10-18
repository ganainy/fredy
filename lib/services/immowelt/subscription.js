/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Whether an immowelt advert can only be contacted through a paid subscription.
 *
 * Some adverts show the contact button like any other, but the page that opens behind it says the
 * advert is exclusive to members: no message can be sent without a paid account. The exposé's own
 * markup says nothing about it - the answer only appears after the button is pressed - so the
 * question cannot be asked with a request, only by driving a browser through the real flow: open the
 * exposé, click "Nachricht schreiben", and read what the opened page says.
 *
 * The click is expected to open the gate in a new tab. Both the popup and the page that was clicked
 * are read, because the platform may open it either way and the phrase is the only thing that
 * matters, not which surface carries it.
 *
 * The exposé is opened on the warmed session rather than a cold page: immowelt sits behind DataDome,
 * which answers a fresh navigation with the captcha often enough that a cold probe would read as
 * "no gate" for adverts that have one. A probe that cannot get an answer returns null instead of
 * false, so an unanswered advert is not silently recorded as contactable.
 *
 * @module services/immowelt/subscription
 */

import logger from '../logger.js';
import { clickButtonContaining } from '../application/apply/formFiller.js';
import { acquireWarmPage } from '../extractor/warmPages.js';
import { siteOf } from './site.js';

/**
 * The controls that open the contact flow, tried in order by their visible text.
 *
 * `formFiller.js` clicks the first match; the join/contact flow is behind one of these on every
 * immowelt design seen so far, and the generic "kontaktieren" catches a relabelled button.
 */
const CONTACT_PHRASES = ['nachricht schreiben', 'anbieter kontaktieren', 'kontaktieren', 'nachricht'];

/**
 * The sentence the platform answers with when the advert is members-only.
 *
 * Matched on "exklusiv für Mitglieder" rather than the full quoted sentence, because the trailing
 * "von <portal>" varies with the site (immowelt.de, immowelt.at) and is not part of the question.
 */
const MEMBERS_ONLY = /exklusiv für mitglieder/i;

/** How long the exposé navigation may take. */
const NAVIGATION_TIMEOUT = 60_000;

/**
 * How long to wait for the contact page to open, and then for it to finish rendering.
 *
 * The click itself is synchronous, but the gate is a client-rendered page: it is not there the
 * instant the tab exists. Waiting once for the tab and once more for its network to fall idle keeps
 * the read from racing the render without a blind sleep.
 */
const OPEN_TIMEOUT = 8_000;
const SETTLE_TIMEOUT = 5_000;
const SETTLE_IDLE_MS = 500;

/**
 * How long to keep watching for the sentence after the network fell idle.
 *
 * A gate that renders from a request of its own can arrive a moment after the last byte; watching
 * for the text itself is what catches it. Absent from the fake pages the tests drive, where it is
 * skipped, so the unit tests do not sit out this timeout.
 */
const LATE_TEXT_TIMEOUT = 3_000;

/**
 * Wait for a page's network to fall idle, or give up quietly.
 *
 * A page that keeps polling never goes idle, and a page that failed to load throws; neither is a
 * reason to abandon a probe that may already have the answer on screen.
 *
 * @param {any} page
 * @returns {Promise<void>}
 */
async function settle(page) {
  if (!page) return;
  try {
    await page.waitForNetworkIdle({ idleTime: SETTLE_IDLE_MS, timeout: SETTLE_TIMEOUT });
  } catch {
    // timed out or the page went away; whatever rendered is read anyway
  }
}

/**
 * Watch a page for the members-only sentence, for a page that renders it late.
 *
 * A no-op on a page without `waitForFunction` (the test doubles), which is deliberate: it is a
 * second chance for a slow render, not the primary read.
 *
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function phraseAppearsLate(page) {
  if (!page || typeof page.waitForFunction !== 'function') return false;
  try {
    await page.waitForFunction(
      (needle) => (document.body?.innerText ?? '').toLowerCase().includes(needle),
      { timeout: LATE_TEXT_TIMEOUT },
      'exklusiv für mitglieder',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a page's markup, or an empty string when it is already gone.
 *
 * @param {any} page
 * @returns {Promise<string>}
 */
async function contentOf(page) {
  if (!page) return '';
  try {
    return await page.content();
  } catch {
    return '';
  }
}

/**
 * Answer whether an immowelt listing is contactable without a paid subscription.
 *
 * @param {string} link absolute url of the exposé
 * @param {any} browser the subscription checker's browser, started once per run
 * @returns {Promise<boolean|null>} `true` when the members-only page was seen, `false` when the
 *   contact flow opened without it, `null` when the question could not be answered
 */
export async function probeSubscriptionRequirement(link, browser) {
  const site = siteOf(link);
  if (site == null) return null;

  let popup = null;
  try {
    const page = await acquireWarmPage(browser, site.origin, { label: site.host });

    // Registered before the click so the tab cannot open between the click and the watch.
    const popupPromise = browser
      .waitForTarget((target) => target.type() === 'page' && target.opener() === page.target(), {
        timeout: OPEN_TIMEOUT,
      })
      .then((target) => target.page())
      .catch(() => null);

    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });

    const clicked = await clickButtonContaining(page, CONTACT_PHRASES);
    if (!clicked) {
      // No contact control found: a redesigned page, or a bot wall standing in for the exposé.
      // Unknown rather than "no gate", so the listing stays due.
      return null;
    }

    popup = await popupPromise;

    // Let the opened surface render whatever it is going to say; a popup that never loads leaves
    // the page's own content to read.
    await Promise.all([settle(popup), settle(page)]);

    const popupContent = await contentOf(popup);
    const pageContent = await contentOf(page);
    if (MEMBERS_ONLY.test(popupContent) || MEMBERS_ONLY.test(pageContent)) {
      return true;
    }

    // Nothing in the markup yet: watch for the sentence itself before calling it contactable,
    // because a gate that renders a beat late must not be recorded as "no gate".
    return (await phraseAppearsLate(popup)) || (await phraseAppearsLate(page));
  } catch (error) {
    logger.warn(
      `Could not check whether the immowelt listing '${link}' needs a subscription.`,
      error?.message || error,
    );
    return null;
  } finally {
    try {
      if (popup && !popup.isClosed()) await popup.close();
    } catch {
      // a tab that cannot be closed is left to the browser closing at the end of the run
    }
  }
}
