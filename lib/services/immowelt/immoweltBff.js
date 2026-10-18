/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Transport for immowelt's search BFF.
 *
 * Immowelt serves its listings as JSON, but the whole origin sits behind DataDome. A plain
 * `fetch` from node is answered with 403 "Please enable JS" no matter which headers it carries,
 * and replaying a browser's `datadome` cookie into node does not help either - DataDome
 * fingerprints the TLS and HTTP/2 handshake, which node cannot forge. The API is therefore called
 * from inside the browser Fredy already runs: one warm-up navigation earns the cookie, and every
 * request after that is a same-origin `fetch` issued by the page itself.
 *
 * That is also the point of doing it this way. Scraping the rendered pages costs one full document
 * navigation for the result page plus one for every listing whose details are wanted; here it is a
 * single navigation to the (cheapest, least scrutinised) home page for the entire run, after which
 * the requests are XHRs on an established session. Fewer scored navigations per run means fewer
 * runs that end at a bot wall.
 *
 * Endpoints used:
 * - `POST /serp-bff/search` - takes `{criteria, paging}` (see `immowelt-search-model.js`), answers
 *   `{totalCount, classifieds: [{id}]}`. Ids only.
 * - `GET /classifiedList/{id},{id},…` with an `x-language` header - answers the full card payload
 *   per id: title, prices, key facts, address, gallery, agent contact and a 500 character
 *   description.
 *
 * Commute areas ("45 minutes by car of Lindenthalgürtel") are resolved by immowelt itself: the one
 * routing call this transport used to make (`/search-mfe-bff/routing/isochrone`) is gone - DataDome
 * refuses it whatever the session, and immowelt's own page does not call it any more either. The
 * boundary is drawn server-side these days, while the result page renders, so {@link
 * resolveCommuteAreas} opens the job's own search url and reads the resolved `location.polylines`
 * off the `POST /search-mfe-bff/v1/count` the page's frontend sends with its result count.
 */

import logger from '../logger.js';
import { trackPoi } from '../tracking/Tracker.js';
import { TRACKING_POIS } from '../../TRACKING_POIS.js';
import { acquireWarmPage as acquireOriginPage, releaseWarmPage } from '../extractor/warmPages.js';
import { SITES, linkedSiteOf, siteOf } from './site.js';

/**
 * The German site's origin.
 *
 * Which origin a call goes to is a property of the job now that immowelt.at is served too - see
 * `site.js` - so this is no longer "the" origin, only the one every caller without a url of its own
 * means. Kept because the fixture downloader and the live criteria test warm a page by hand.
 */
export const IMMOWELT_ORIGIN = SITES['immowelt.de'].origin;

/** How long one navigation to the job's search page may take. */
const NAVIGATION_TIMEOUT = 60_000;

/** How long one BFF round trip may take. */
const REQUEST_TIMEOUT = 45_000;

/** How long one attempt waits for the search page's own result count. */
const COUNT_TIMEOUT = 30_000;

/**
 * How often the search page navigation is tried before the run gives up on its commute area.
 *
 * DataDome interstitials roughly every other navigation to the result page - not enough to call the
 * session blocked, but enough that the first attempt regularly lands on the device check the page
 * resolves by itself. Retrying on a fresh page passes a high share of those; giving up on one
 * navigation would mark every other commute run a failure.
 */
const SEARCH_PAGE_ATTEMPTS = 3;

/** How long to leave the site alone between two search-page attempts. */
const SEARCH_PAGE_PAUSE = 5_000;

/**
 * How many ids one `/classifiedList` request may carry.
 *
 * The ids go into the path, and immowelt's edge answers 403 once that path grows past roughly a
 * kilobyte - 50 ids (665 characters) still pass, 100 ids (1315) do not. The limit is a property of
 * the request rather than of the session: it fires on the very first call from a fresh browser and
 * keeps firing at exactly that size. 30 is what immowelt's own result page asks for, which keeps
 * the requests both short enough and shaped like the ones the site makes itself.
 */
const CLASSIFIED_LIST_BATCH_SIZE = 30;

/**
 * The origins DataDome has refused an exposé on, per browser.
 *
 * Keyed on the browser for the same reason the warm pages are: it is exactly the lifetime of one
 * job run, so the next run starts unflagged without anything having to reset it. Per origin within
 * that, because being refused by immowelt.at says nothing about immowelt.de.
 *
 * @type {WeakMap<object, Set<string>>}
 */
const blockedOrigins = new WeakMap();

/**
 * A page with an established session on the site a request goes to - see `extractor/warmPages.js`
 * for how it is warmed and why it is kept per browser and per origin.
 *
 * @param {any} browser the shared browser of the current job run
 * @param {import('./site.js').ImmoweltSite} site the site the request goes to
 * @returns {Promise<any>} a page on the site's origin
 */
function acquireWarmPage(browser, site) {
  return acquireOriginPage(browser, site.origin, { label: site.host });
}

/**
 * Close the warmed pages of a browser, if it has any.
 *
 * Not needed for the job runs themselves - `closeBrowser` takes the pages down with the browser -
 * but tests and the fixture downloader reuse one browser across several calls and want to let go
 * of them explicitly. The page of every site of the platform goes: a caller asking to drop the
 * session means all of them, not the one site it happens to have searched.
 *
 * @param {any} browser the browser whose sessions should be dropped
 * @returns {Promise<void>}
 */
export async function releaseSession(browser) {
  for (const site of Object.values(SITES)) {
    await releaseWarmPage(browser, site.origin);
  }
}

/**
 * Report a blocked request the same way the puppeteer extractor does, so the bot-detection POI
 * stays comparable no matter which path a provider takes.
 *
 * The POI is named after the provider, not the site, so it stays `_immowelt` for both immowelt
 * sites. It measures how often Fredy hits that portal's bot wall, and DataDome scores the client
 * rather than the domain, so splitting the counter per country would halve a number that describes
 * one thing. SeLoger counts under `_seloger`: a portal of its own to the people using it, and
 * reported under its own id like every other provider. The log line names the host, which is what
 * a user debugging their own job needs.
 *
 * @param {number} status the http status the BFF answered with
 * @param {string} step which call was blocked, for the log line
 * @param {string} body the first part of the response body
 * @param {import('./site.js').ImmoweltSite} site the site the request went to
 * @returns {Promise<void>}
 */
async function reportFailure(status, step, body, site) {
  if (status === 403 || status === 429) {
    logger.warn(`We have been detected as a bot :-/ ${site.host} ${step} answered ${status}.`);
    await trackPoi(`${TRACKING_POIS.DETECTED_AS_BOT}_${site.provider}`);
    return;
  }
  // The BFF validates the criteria and names both the offending path and the values it would have
  // accepted. That message is the only thing that turns "0 listings" into something a user can act
  // on, so it is logged in full rather than swallowed.
  logger.error(`${site.host} ${step} answered ${status}: ${body}`);
}

/**
 * Draw the boundary of a search's commute areas by letting immowelt draw it.
 *
 * The routing service this asked directly (`/search-mfe-bff/routing/isochrone`) is retired: DataDome
 * refuses it whatever the session holds, and immowelt's own page has stopped calling it too. The
 * boundary is drawn server-side these days, while the result page renders, so this loads the job's
 * own search url - the very page the user sees, which answers with the resolved area - and reads the
 * `location.polylines` off the `POST /search-mfe-bff/v1/count` the page's frontend sends back with
 * its result count.
 *
 * The page is opened in the browser of the current run, so it shares the warmed session's DataDome
 * cookie; one navigation with its ~1.5 MB of assets is the price of a commute search. A navigation
 * that produces no result count - or one the wall refuses outright - is retried on a fresh page,
 * {@link SEARCH_PAGE_ATTEMPTS} times: the device check the interstitial shows resolves itself, and
 * the attempt after a refusal usually gets through. The url replaces the place of every area in it:
 * the resolved polylines are what immowelt searches by, so a `locations` parameter naming places
 * beside commutes keeps none of them anyway (see `parseLocations` in `immowelt-search-model.js`).
 *
 * A commute that cannot be resolved ends the run rather than searching without it: dropping the
 * boundary leaves the bare place id, which is the street instead of the quarter around it, and the
 * job would quietly report a different set of flats than the saved search describes.
 *
 * @param {any} browser the shared browser of the current job run
 * @param {import('./site.js').ImmoweltSite} site the site this run searches
 * @param {string} searchUrl the job's own search url, sorted by date
 * @returns {Promise<string[]>} one encoded polyline per reachable area
 * @throws {Error} when immowelt does not answer with a boundary for the search
 */
async function resolveCommuteAreas(browser, site, searchUrl) {
  // The search page is navigated by a browser that already holds a session, so the warm page has to
  // exist first; without it the navigation lands on DataDome before any cookie is earned.
  await acquireWarmPage(browser, site);

  let lastSilence = null;
  for (let attempt = 1; attempt <= SEARCH_PAGE_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      logger.warn(`${site.host} did not draw this job's commute area on attempt ${attempt - 1}; navigating again.`);
      await new Promise((resolve) => setTimeout(resolve, SEARCH_PAGE_PAUSE));
    }

    try {
      const polylines = await drawCommuteArea(browser, site, searchUrl);
      if (attempt > 1) {
        logger.warn(`${site.host} drew the commute area on attempt ${attempt} of ${SEARCH_PAGE_ATTEMPTS}.`);
      }
      return polylines;
    } catch (error) {
      // A silent or refused navigation is retried - that is the interstitial resolving itself, and
      // the next attempt usually gets through. A real answer of "nothing reachable" ends the run.
      if (error?.name === 'TimeoutError' || error?.name === 'NavigationRefused') {
        lastSilence = error;
        continue;
      }
      throw error;
    }
  }

  // The two silences end the run with the message of whichever shape the last refusal had: a page
  // that never posted its result count, and one that the wall refused outright, are different
  // advice to a debugging user - but both mean the same consequence for the run.
  if (lastSilence?.name === 'NavigationRefused') {
    throw new Error(
      `${site.host} refused to render this job's search page, whose commute time only it can measure. ` +
        `Searching without it would cover the street instead of everything around it, so the job stops instead.`,
    );
  }
  throw new Error(
    `${site.host} never sent Fredy the boundary of this job's commute time (no result count on the ` +
      `search page). Searching without it would cover the street instead of everything around it, so the ` +
      `job stops instead.`,
  );
}

/**
 * Load the job's search page once and read its resolved commute boundary off the result count.
 *
 * @param {any} browser the shared browser of the current job run
 * @param {import('./site.js').ImmoweltSite} site the site this run searches
 * @param {string} searchUrl the job's own search url, sorted by date
 * @returns {Promise<string[]>} one encoded polyline per reachable area
 * @throws {Error} - the error name tells the caller which silences are worth retrying:
 *   `TimeoutError` when the page never posted a result count, `NavigationRefused` when the wall
 *   refused the page itself; every other failure names exactly why the run cannot go on
 */
async function drawCommuteArea(browser, site, searchUrl) {
  const page = await browser.newPage();
  try {
    // Registered before the navigation, because the count can leave while the page is still loading.
    // A catch is hung off the waiting itself: when the navigation refuses first, the wait must not
    // turn into an unhandled rejection of its own.
    const countRequestPromise = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().startsWith(`${site.origin}/search-mfe-bff/v1/count`),
      { timeout: COUNT_TIMEOUT },
    );
    countRequestPromise.catch(() => {});

    const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
    if (response != null && (response.status() === 403 || response.status() === 429)) {
      await reportFailure(response.status(), `search page ${searchUrl}`, '', site);
      throw Object.assign(new Error(`${site.host} refused to render this job's search page.`), {
        name: 'NavigationRefused',
      });
    }

    const countRequest = await countRequestPromise;
    /** @type {string[]|null|undefined} */
    let polylines = null;
    try {
      // fetchPostData, not the deprecated sync postData(): that one is undefined for large bodies.
      polylines = JSON.parse(String(await countRequest.fetchPostData()))?.criteria?.location?.polylines;
    } catch (error) {
      // an unparsable count counts as an answer without a boundary, handled below
      logger.warn(`${site.host} sent a result count Fredy could not read: ${error?.message || error}`);
    }
    if (!Array.isArray(polylines) || polylines.length === 0) {
      throw new Error(
        `${site.host} answered this job's commute time without a reachable area, so there is nothing to search in.`,
      );
    }

    return polylines;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Finish a translated search url into the body the BFF is posted.
 *
 * Everything but the commute areas is already in `criteria`; those are replaced here by the
 * polylines immowelt drew for the url - see {@link resolveCommuteAreas}. The BFF unions the
 * polylines of a search, so a resolved commute joins the areas already in the criteria rather than
 * replacing them - which is what the resolved search carries anyway, its several islands included.
 *
 * @param {any} browser the shared browser of the current job run
 * @param {{searchUrl?: string, criteria: object, paging: object, commutes?: import('./immowelt-search-model.js').CommuteArea[]}} request
 *   the translated search url
 * @param {import('./site.js').ImmoweltSite} site the site this run searches
 * @returns {Promise<{criteria: object, paging: object}>} the body to post
 * @throws {Error} when a commute area of the search cannot be resolved into a boundary
 */
export async function resolveSearchAreas(browser, { searchUrl, criteria, paging, commutes = [] }, site) {
  if (commutes.length === 0) return { criteria, paging };
  if (searchUrl == null || searchUrl.trim() === '') {
    throw new Error(
      `${site.brand} cannot measure a commute time without the search url it belongs to, but none reached the transport.`,
    );
  }

  const polylines = await resolveCommuteAreas(browser, site, searchUrl);

  return {
    criteria: {
      ...criteria,
      location: { ...criteria.location, polylines: [...(criteria.location?.polylines ?? []), ...polylines] },
    },
    paging,
  };
}

/**
 * Run the search and resolve the resulting ids into full card payloads.
 *
 * A batch that fails does not sink the ones that succeeded. Anything missed stays unstored, so it
 * simply counts as new on the next run - reporting half a result page beats reporting none.
 *
 * @param {any} browser the shared browser of the current job run
 * @param {{searchUrl?: string, criteria: object, paging: object, commutes?: import('./immowelt-search-model.js').CommuteArea[]}} request
 *   the body for `/serp-bff/search`, as `convertSearchUrlToRequest` built it; `searchUrl` is the
 *   url itself, needed only when the search carries a commute area
 * @param {import('./site.js').ImmoweltSite} site the site this run searches
 * @returns {Promise<any[]>} the raw classifieds, or an empty array when the search was refused
 * @throws {Error} when a commute area of the search cannot be resolved into a boundary
 */
export async function searchClassifieds(browser, request, site) {
  const payload = await resolveSearchAreas(browser, request, site);
  const page = await acquireWarmPage(browser, site);

  const result = await page.evaluate(
    async (payload, timeout, batchSize, language) => {
      const withTimeout = (promise) =>
        Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('immowelt bff request timed out')), timeout)),
        ]);

      try {
        const searchResponse = await withTimeout(
          fetch('/serp-bff/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload),
          }),
        );
        const searchBody = await searchResponse.text();
        if (searchResponse.status !== 200) {
          return { error: { step: 'search', status: searchResponse.status, body: searchBody.slice(0, 800) } };
        }

        const ids = (JSON.parse(searchBody).classifieds || []).map((entry) => entry?.id).filter(Boolean);
        if (ids.length === 0) return { classifieds: [] };

        const classifieds = [];
        let failure = null;

        for (let offset = 0; offset < ids.length; offset += batchSize) {
          const batch = ids.slice(offset, offset + batchSize);
          const listResponse = await withTimeout(
            fetch(`/classifiedList/${batch.join(',')}`, { headers: { 'x-language': language } }),
          );
          const listBody = await listResponse.text();
          if (listResponse.status !== 200) {
            failure ??= { step: 'classifiedList', status: listResponse.status, body: listBody.slice(0, 800) };
            break;
          }
          classifieds.push(...JSON.parse(listBody));
        }

        return { classifieds, error: failure };
      } catch (error) {
        return { error: { step: 'request', status: 0, body: String(error?.message || error) } };
      }
    },
    payload,
    REQUEST_TIMEOUT,
    CLASSIFIED_LIST_BATCH_SIZE,
    site.language,
  );

  const classifieds = Array.isArray(result.classifieds) ? result.classifieds : [];

  if (result.error != null) {
    await reportFailure(result.error.status, result.error.step, result.error.body, site);
    if (classifieds.length > 0) {
      logger.warn(
        `${site.host} returned ${classifieds.length} listing(s) before the request was refused; keeping those.`,
      );
    }
  }

  return classifieds;
}

/**
 * Load an exposé page as markup, without navigating to it.
 *
 * The exposé carries the untruncated description, which the card payload only has the first 500
 * characters of. Fetching it as a subresource of the already-open session rather than navigating
 * there keeps the enrichment to one XHR per listing instead of one full page load with its ~1.5 MB
 * of assets and its own DataDome challenge.
 *
 * Once DataDome refuses one exposé it refuses the rest of them too, and every further attempt is
 * another strike against an address that is already flagged. The first refusal therefore ends the
 * enrichment for this run: the session is dropped and the remaining listings are stored with the
 * card's truncated description, which is what they would have got anyway. Refusals are counted per
 * site, because being turned away by immowelt.at says nothing about immowelt.de.
 *
 * The site is read off the exposé's own link rather than passed in: the link is what the request
 * goes to, and reading it here is what keeps an Austrian exposé from being fetched cross-origin
 * from a German page, which the browser refuses outright. A link on no immowelt site is not
 * fetched at all - the listing simply keeps its card description.
 *
 * @param {any} browser the shared browser of the current job run
 * @param {string} url absolute url of the exposé
 * @returns {Promise<string|null>} the markup, or null when the request was refused
 */
export async function fetchExposeHtml(browser, url) {
  const site = siteOf(url);
  if (site == null) {
    logger.warn(`Not fetching '${url}': it is on no immowelt or SeLoger site Fredy knows.`);
    return null;
  }
  if (blockedOrigins.get(browser)?.has(site.origin)) return null;

  const page = await acquireWarmPage(browser, site);

  const result = await page.evaluate(
    async (target, timeout) => {
      try {
        const response = await Promise.race([
          fetch(target, { headers: { Accept: 'text/html' } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('immowelt expose request timed out')), timeout)),
        ]);
        const body = await response.text();
        if (response.status !== 200) {
          return { error: { status: response.status, body: body.slice(0, 400) } };
        }
        return { html: body };
      } catch (error) {
        return { error: { status: 0, body: String(error?.message || error) } };
      }
    },
    url,
    REQUEST_TIMEOUT,
  );

  if (result.error != null) {
    await reportFailure(result.error.status, `exposé ${url}`, result.error.body, site);
    if (result.error.status === 403 || result.error.status === 429) await refuseSite(browser, site);
    return null;
  }

  return result.html;
}

/**
 * Whether an exposé is still online - the activity probe of the platform's providers.
 *
 * Asked from inside the session, because that is the only place the platform answers the question:
 * a plain request from node meets the DataDome wall with a 403 whether the advert is up or not, and
 * counting those as failures took every listing offline once its failure streak ran out. Measured
 * in September 2026 on immowelt.de and seloger.com, a live exposé answers 200 and a taken-down one
 * 410. The request has to be a GET: a HEAD answers 403 for a taken-down exposé, the bot wall's
 * answer. Only the status is read; the markup behind it is not downloaded.
 *
 * A refusal ends the probing of that site for the run, like it ends the exposé fetches.
 *
 * @param {any} browser the browser of the current probe run
 * @param {string} url absolute url of the exposé
 * @returns {Promise<number>} 1 online, 0 taken down, -1 when the platform gave no usable answer
 */
export async function probeExpose(browser, url) {
  const site = linkedSiteOf(url);
  if (site == null || blockedOrigins.get(browser)?.has(site.origin)) return -1;

  const page = await acquireWarmPage(browser, site);

  const status = await page.evaluate(
    async (target, timeout) => {
      try {
        const response = await Promise.race([
          fetch(target, { headers: { Accept: 'text/html' } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('exposé probe timed out')), timeout)),
        ]);
        try {
          await response.body?.cancel();
        } catch {
          // a body that cannot be cancelled is simply left to the browser
        }
        return response.status;
      } catch {
        return 0;
      }
    },
    url,
    REQUEST_TIMEOUT,
  );

  if (status === 200) return 1;
  if (status === 404 || status === 410) return 0;
  if (status === 403 || status === 429) {
    await reportFailure(status, `exposé probe ${url}`, '', site);
    await refuseSite(browser, site);
  }
  return -1;
}

/**
 * Stop asking a site anything for the rest of the run: once DataDome has refused one request it
 * refuses the rest, and every further attempt is another strike against an address that is already
 * flagged. The session is dropped with it.
 *
 * @param {any} browser the browser of the current run
 * @param {import('./site.js').ImmoweltSite} site the site that refused
 * @returns {Promise<void>}
 */
async function refuseSite(browser, site) {
  const blocked = blockedOrigins.get(browser) ?? new Set();
  blocked.add(site.origin);
  blockedOrigins.set(browser, blocked);
  await releaseWarmPage(browser, site.origin);
  logger.warn(`Skipping the remaining ${site.host} requests of this run; the session has been refused.`);
}
