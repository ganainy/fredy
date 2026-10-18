/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const root = (await import('node:path')).resolve('.');
const storagePath = root + '/lib/services/storage/listingsStorage.js';
const settingsPath = root + '/lib/services/storage/settingsStorage.js';
const puppeteerPath = root + '/lib/services/extractor/puppeteerExtractor.js';
const utilsPath = root + '/lib/utils.js';
const loggerPath = root + '/lib/services/logger.js';

let state;

/**
 * Load the subscription checker with its storage, provider lookup and browser replaced.
 *
 * @param {(link: string, browser: any) => Promise<boolean|null>} [prob] The provider probe. Defaults
 *   to "contactable without a subscription".
 * @param {object} [config] The provider config, when a test needs more than the plain probe.
 * @returns {Promise<Function>} runSubscriptionChecker
 */
async function loadService(
  probe = async (link) => (link in state.results ? state.results[link] : false),
  config = { subscriptionProbe: probe },
) {
  vi.resetModules();
  vi.doMock(settingsPath, () => ({ getSettings: async () => state.settings }));
  vi.doMock(puppeteerPath, () => ({
    launchBrowser: async (url, options) => {
      state.launches.push(options);
      if (state.launchFails) throw new Error('Chromium would not start');
      return state.browser;
    },
    closeBrowser: async (browser) => {
      state.closed.push(browser);
    },
  }));
  vi.doMock(storagePath, () => ({
    getListingsDueForSubscriptionCheck: (params) => {
      state.dueParams = params;
      return state.due;
    },
    applySubscriptionCheck: (id, requires, checkedAt) => state.applied.push({ id, requires, checkedAt }),
  }));
  vi.doMock(utilsPath, async (importOriginal) => ({
    // Partial mock: only the provider lookup is faked, `mapLimit` is the real helper.
    ...(await importOriginal()),
    getProviders: async () => state.providers ?? [{ metaInformation: { id: 'immowelt' }, config }],
  }));
  vi.doMock(loggerPath, () => ({
    default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  }));
  return (await import(root + '/lib/services/listings/subscriptionCheckService.js')).default;
}

const listing = (id) => ({ id, link: `https://www.immowelt.de/expose/${id}`, provider: 'immowelt' });

describe('services/listings/subscriptionCheckService', () => {
  beforeEach(() => {
    state = {
      due: [],
      results: {},
      applied: [],
      dueParams: null,
      providers: null,
      settings: {},
      browser: { id: 'browser' },
      launches: [],
      closed: [],
      launchFails: false,
    };
  });

  it('records a listing whose contact needs a subscription', async () => {
    state.due = [listing('gated')];
    state.results['https://www.immowelt.de/expose/gated'] = true;
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.applied).toHaveLength(1);
    expect(state.applied[0]).toMatchObject({ id: 'gated', requires: true });
  });

  it('records a listing that is contactable without one', async () => {
    state.due = [listing('open')];
    state.results['https://www.immowelt.de/expose/open'] = false;
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.applied[0]).toMatchObject({ id: 'open', requires: false });
  });

  it('records an unanswered probe rather than dropping the listing', async () => {
    // The timestamp is what makes the listing wait out the retry window. Not recording it would ask
    // the same question on the very next run.
    state.due = [listing('blocked')];
    state.results['https://www.immowelt.de/expose/blocked'] = null;
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.applied[0]).toMatchObject({ id: 'blocked', requires: null });
  });

  it('counts a probe that threw as unknown', async () => {
    state.due = [listing('boom')];
    const runSubscriptionChecker = await loadService(async () => {
      throw new Error('Target closed');
    });

    await runSubscriptionChecker();

    expect(state.applied[0]).toMatchObject({ id: 'boom', requires: null });
  });

  it('asks only for the listings of the providers that declare a probe', async () => {
    state.due = [listing('gated')];
    state.results['https://www.immowelt.de/expose/gated'] = true;
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker({ limit: 42 });

    expect(state.dueParams).toMatchObject({ providerIds: ['immowelt'], limit: 42 });
  });

  it('does nothing when no provider declares a probe', async () => {
    state.providers = [{ metaInformation: { id: 'seloger' }, config: {} }];
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.dueParams).toBeNull();
    expect(state.applied).toEqual([]);
    expect(state.launches).toEqual([]);
  });

  it('does nothing when no listing is due', async () => {
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.applied).toEqual([]);
    expect(state.launches).toEqual([]);
  });

  it('starts one browser for the run, hands it to every probe and closes it', async () => {
    state.due = [listing('a'), listing('b')];
    const seen = [];
    const runSubscriptionChecker = await loadService(async (link, browser) => {
      seen.push(browser);
      return state.results[link] ?? false;
    });

    await runSubscriptionChecker();

    expect(state.launches).toHaveLength(1);
    expect(seen).toEqual([state.browser, state.browser]);
    expect(state.closed).toEqual([state.browser]);
  });

  it('starts the browser behind the configured proxy', async () => {
    state.due = [listing('a')];
    state.settings = { proxyUrl: 'http://proxy.example:8080' };
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.launches[0]).toMatchObject({ proxyUrl: 'http://proxy.example:8080' });
  });

  it('closes the browser when a probe throws', async () => {
    state.due = [listing('boom')];
    const runSubscriptionChecker = await loadService(async () => {
      throw new Error('Target closed');
    });

    await runSubscriptionChecker();

    expect(state.closed).toEqual([state.browser]);
  });

  it('records unknown when the browser will not start', async () => {
    state.due = [listing('a')];
    state.launchFails = true;
    const runSubscriptionChecker = await loadService();

    await runSubscriptionChecker();

    expect(state.applied[0]).toMatchObject({ id: 'a', requires: null });
  });
});
