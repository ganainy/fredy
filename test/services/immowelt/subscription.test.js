/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const root = (await import('node:path')).resolve('.');
const formFillerPath = root + '/lib/services/application/apply/formFiller.js';
const warmPagesPath = root + '/lib/services/extractor/warmPages.js';
const loggerPath = root + '/lib/services/logger.js';

let state;
let clickButtonContaining;

/**
 * Load the immowelt subscription probe with its page, click helper and logger replaced.
 *
 * @returns {Promise<Function>} probeSubscriptionRequirement
 */
async function loadProbe() {
  vi.resetModules();
  clickButtonContaining = vi.fn(async () => state.clicked);
  vi.doMock(formFillerPath, () => ({ clickButtonContaining }));
  vi.doMock(warmPagesPath, () => ({ acquireWarmPage: async () => state.page }));
  vi.doMock(loggerPath, () => ({
    default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  }));
  return (await import(root + '/lib/services/immowelt/subscription.js')).probeSubscriptionRequirement;
}

const LINK = 'https://www.immowelt.de/expose/abc123';

/** The sentence the platform answers a members-only advert with. */
const MEMBERS_ONLY = 'Diese Anzeige ist exklusiv für Mitglieder von immowelt.de';

describe('services/immowelt/subscription', () => {
  beforeEach(() => {
    const target = { id: 'expose-target' };
    state = {
      clicked: true,
      pageContent: '<html><body>Exposé</body></html>',
      popupContent: '',
      popupOpen: true,
      gotoThrows: false,
      popup: null,
      target,
      navigated: [],
      closedPopups: [],
      acquired: [],
      waitForTargetPredicate: null,
      browser: null,
      page: null,
    };

    state.popup = {
      target: () => ({ id: 'popup-target' }),
      content: async () => state.popupContent,
      waitForNetworkIdle: async () => {},
      isClosed: () => false,
      close: async () => {
        state.closedPopups.push('popup');
      },
    };

    state.page = {
      target: () => target,
      goto: async (url) => {
        state.navigated.push(url);
        if (state.gotoThrows) throw new Error('net::ERR_ABORTED');
      },
      content: async () => state.pageContent,
      waitForNetworkIdle: async () => {},
    };

    state.browser = {
      waitForTarget: (predicate, options) => {
        state.waitForTargetPredicate = predicate;
        state.waitForTargetOptions = options;
        if (!state.popupOpen) return Promise.reject(new Error('timeout'));
        return Promise.resolve({ page: async () => state.popup });
      },
    };
  });

  it('reports a gate when the opened page says the advert is members-only', async () => {
    state.popupContent = `<html><body>${MEMBERS_ONLY}</body></html>`;
    const probe = await loadProbe();

    await expect(probe(LINK, state.browser)).resolves.toBe(true);
    expect(state.navigated).toEqual([LINK]);
  });

  it('reports a gate when the clicked page itself carries the sentence', async () => {
    // The platform may open the gate in the same tab rather than a new one; the phrase is the
    // question either way.
    state.popupOpen = false;
    state.pageContent = `<html><body>${MEMBERS_ONLY}</body></html>`;
    const probe = await loadProbe();

    await expect(probe(LINK, state.browser)).resolves.toBe(true);
  });

  it('reports no gate when the contact page opened without the sentence', async () => {
    state.popupContent = '<html><body>Nachricht an den Anbieter</body></html>';
    const probe = await loadProbe();

    await expect(probe(LINK, state.browser)).resolves.toBe(false);
  });

  it('is unknown when no contact control could be found', async () => {
    state.clicked = false;
    const probe = await loadProbe();

    await expect(probe(LINK, state.browser)).resolves.toBeNull();
    expect(state.navigated).toEqual([LINK]);
  });

  it('is unknown for a link on no site of the platform, without opening a page', async () => {
    const probe = await loadProbe();

    await expect(probe('https://www.example.com/expose/1', state.browser)).resolves.toBeNull();
    expect(state.navigated).toEqual([]);
  });

  it('is unknown when the exposé cannot be opened', async () => {
    state.gotoThrows = true;
    const probe = await loadProbe();

    await expect(probe(LINK, state.browser)).resolves.toBeNull();
  });

  it('closes the tab the click opened', async () => {
    state.popupContent = '<html><body>Nachricht an den Anbieter</body></html>';
    const probe = await loadProbe();

    await probe(LINK, state.browser);

    expect(state.closedPopups).toEqual(['popup']);
  });

  it('watches only for a page the exposé itself opened', async () => {
    const probe = await loadProbe();

    await probe(LINK, state.browser);

    const predicate = state.waitForTargetPredicate;
    expect(predicate({ type: () => 'page', opener: () => state.target })).toBe(true);
    expect(predicate({ type: () => 'page', opener: () => ({ id: 'other' }) })).toBe(false);
    expect(predicate({ type: () => 'background_page', opener: () => state.target })).toBe(false);
  });
});
