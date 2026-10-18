/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { applySubscriptionCheck, getListingsDueForSubscriptionCheck } from '../storage/listingsStorage.js';
import { getSettings } from '../storage/settingsStorage.js';
import { closeBrowser, launchBrowser } from '../extractor/puppeteerExtractor.js';
import { getProviders, mapLimit } from '../../utils.js';
import logger from '../logger.js';

/**
 * Runs the subscription checker:
 * 1) Resolves the providers that declare a `subscriptionProbe` and asks only for their listings.
 * 2) For each due listing, calls `subscriptionProbe(link, browser)` - a browser probe by nature,
 *    because the answer only exists behind a click on the rendered exposé.
 * 3) Records the tri-state result, stamping the checked-at time even when the answer was unknown.
 *
 * A probe that cannot tell (`null`) is recorded too: the timestamp is what makes the listing wait
 * out `SUBSCRIPTION_CHECK_RETRY_MS` before it is asked again, instead of being retried on the very
 * next run and starving the listings nobody has looked at yet.
 *
 * The browser is started once per run, behind the configured proxy, and only when a due listing
 * actually needs it, so a run that finds nothing to do never pays for a Chromium start. Probes run
 * one at a time: they share one warmed page per origin, and driving it concurrently would interleave
 * one listing's navigation with another's click.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=200] Max listings probed per run.
 * @param {number} [opts.concurrency=1] Max parallel probes. Kept at one: the probes share the run's
 *   warm page, and two navigations on it at once would read each other's content.
 * @param {number} [opts.retryAfterMs] Re-probe an unanswered listing after this long (default 7 days).
 * @returns {Promise<void>}
 */
export default async function runSubscriptionChecker(opts = {}) {
  const { limit = 200, concurrency = 1, retryAfterMs } = opts;

  const providers = await getProviders();
  if (!Array.isArray(providers) || providers.length === 0) {
    logger.debug('No providers available. Skipping subscription checks.');
    return;
  }

  /** @type {Record<string, any>} */
  const providerById = Object.create(null);
  /** @type {string[]} */
  const capableProviderIds = [];
  for (const p of providers) {
    const id = p?.metaInformation?.id;
    const probe = p?.config?.subscriptionProbe;
    if (id && typeof probe === 'function') {
      providerById[id] = p;
      capableProviderIds.push(id);
    }
  }

  if (capableProviderIds.length === 0) {
    logger.debug('No provider declares a subscription probe. Skipping.');
    return;
  }

  const listings = getListingsDueForSubscriptionCheck({
    providerIds: capableProviderIds,
    limit,
    ...(retryAfterMs != null ? { retryAfterMs } : {}),
  });
  if (!Array.isArray(listings) || listings.length === 0) {
    logger.debug('No listings due for a subscription check.');
    return;
  }

  /** @type {Promise<any>|null} */
  let browserPromise = null;
  const ensureBrowser = (link) => {
    if (browserPromise == null) {
      browserPromise = getSettings().then((settings) => launchBrowser(link, { proxyUrl: settings?.proxyUrl }));
    }
    return browserPromise;
  };

  let checked = 0;
  let gated = 0;
  try {
    await mapLimit(listings, concurrency, async (listing) => {
      const { provider: listingProviderId, link, id } = listing || {};

      const matchedProvider = providerById[listingProviderId];
      const probe = matchedProvider?.config?.subscriptionProbe;
      if (!id || !link || typeof probe !== 'function') {
        logger.warn('Could not find a subscription probe for', listingProviderId);
        return;
      }

      let result = null;
      try {
        result = await probe(link, await ensureBrowser(link));
      } catch (error) {
        logger.warn(`Subscription probe for '${link}' failed.`, error?.message || error);
        result = null;
      }

      applySubscriptionCheck(id, result);
      checked += 1;
      if (result === true) gated += 1;
    });
  } finally {
    if (browserPromise != null) {
      // Awaited rather than ignored: a launch still in flight would otherwise resolve into a browser
      // nobody holds a reference to any more.
      await browserPromise.then(closeBrowser).catch(() => {});
    }
  }

  logger.debug(`Subscription check probed ${checked} of ${listings.length} due listings, ${gated} gated.`);
}
