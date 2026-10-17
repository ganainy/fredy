/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const root = (await import('node:path')).resolve('.');

const listing = {
  id: 'abc',
  provider: 'immoscout',
  dealType: 'rent',
  title: 'Helle 3-Zimmer-Wohnung',
  link: 'https://www.immobilienscout24.de/expose/123',
};

/** @type {string[]} */
let tracked;
/** @type {Array<{listing: any, userId: string}>} */
let startCalls;
/** @type {Array<{sessionId: string, userId: string}>} */
let confirmCalls;
/** @type {Array<{id: string, status: string}>} */
let statusCalls;
/** @type {string[]} */
let watchedIds;
let startResult;
let startError;
let confirmResult;

/**
 * Registers the listings plugin against a fastify double and returns its routes, with
 * `applyService.js` mocked - the browser automation itself is somebody else's tested behaviour
 * (`applyService.js`, `formFiller.js`, `applySessionStore.js` all have their own suites); this is
 * about which listing a user may touch and what the route does with the outcome.
 *
 * @param {Object} [options]
 * @param {Object|null} [options.found] What `getListingById`/`userCanAccessListing` answer with.
 * @returns {Promise<Record<string, Function>>}
 */
async function loadRoutes({ found = listing, canAccess = true } = {}) {
  tracked = [];
  startCalls = [];
  confirmCalls = [];
  statusCalls = [];
  watchedIds = [];
  startResult = { ok: true, sessionId: 'session-1', filled: ['firstName'], missing: [] };
  startError = null;
  confirmResult = true;
  vi.resetModules();

  vi.doMock(root + '/lib/services/storage/listingsStorage.js', () => ({
    getListingById: () => found,
    userCanAccessListing: () => canAccess,
    setListingStatus: (id, status) => {
      statusCalls.push({ id, status });
      return 1;
    },
  }));
  vi.doMock(root + '/lib/services/storage/watchListStorage.js', () => ({
    ensureWatch: (id) => watchedIds.push(id),
  }));
  vi.doMock(root + '/lib/api/security.js', () => ({ isAdmin: () => false }));
  vi.doMock(root + '/lib/services/storage/jobStorage.js', () => ({ getJob: () => null }));
  vi.doMock(root + '/lib/services/storage/settingsStorage.js', () => ({
    getSettings: async () => ({}),
    getUserSettings: () => ({}),
  }));
  vi.doMock(root + '/lib/services/tracking/Tracker.js', () => ({ trackPoi: async (poi) => tracked.push(poi) }));
  vi.doMock(root + '/lib/services/geocoding/distanceService.js', () => ({ updateDistancesForListing: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/geoCodingService.js', () => ({
    geocodeAddress: vi.fn(),
    isGeocodingPaused: () => false,
  }));
  vi.doMock(root + '/lib/services/providers/providerCountries.js', () => ({
    getCountriesForListing: async () => ['de'],
  }));
  vi.doMock(root + '/lib/utils.js', () => ({
    getProviders: async () => [],
    nullOrEmpty: (value) => value == null || value === '',
  }));
  vi.doMock(root + '/lib/services/application/apply/applyService.js', () => ({
    startApplication: async (theListing, userId) => {
      startCalls.push({ listing: theListing, userId });
      if (startError != null) throw startError;
      return startResult;
    },
    confirmApplication: async (sessionId, userId) => {
      confirmCalls.push({ sessionId, userId });
      return confirmResult;
    },
  }));

  const plugin = (await import(root + '/lib/api/routes/listingsRouter.js')).default;
  /** @type {Record<string, Function>} */
  const routes = {};
  await plugin({
    get: () => {},
    post: (path, handler) => (routes[`POST ${path}`] = handler),
    delete: () => {},
    put: () => {},
  });
  return routes;
}

/** A reply double that records what the handler answered. */
function replyDouble() {
  const recorded = { status: 200, payload: undefined };
  return {
    recorded,
    code(status) {
      recorded.status = status;
      return this;
    },
    send(payload) {
      recorded.payload = payload;
      return recorded;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/listings/:listingId/apply', () => {
  it('starts an apply session for a listing the user may access', async () => {
    const routes = await loadRoutes();
    const reply = replyDouble();

    const result = await routes['POST /:listingId/apply'](
      { params: { listingId: 'abc' }, session: { currentUser: 'user-1' } },
      reply,
    );

    expect(result).toEqual(startResult);
    expect(startCalls).toEqual([{ listing, userId: 'user-1' }]);
  });

  it('records that apply-automation was started', async () => {
    const routes = await loadRoutes();
    await routes['POST /:listingId/apply'](
      { params: { listingId: 'abc' }, session: { currentUser: 'user-1' } },
      replyDouble(),
    );

    expect(tracked).toContain('APPLY_AUTOMATION_STARTED');
  });

  it('does not record anything when the browser never opened', async () => {
    const routes = await loadRoutes();
    startResult = { ok: false, reason: 'launchFailed' };

    await routes['POST /:listingId/apply'](
      { params: { listingId: 'abc' }, session: { currentUser: 'user-1' } },
      replyDouble(),
    );

    expect(tracked).not.toContain('APPLY_AUTOMATION_STARTED');
  });

  it("answers 404 for a listing that is gone or is somebody else's", async () => {
    const routes = await loadRoutes({ found: null });
    const reply = replyDouble();

    await routes['POST /:listingId/apply']({ params: { listingId: 'abc' }, session: { currentUser: 'user-1' } }, reply);

    expect(reply.recorded.status).toBe(404);
    expect(startCalls).toHaveLength(0);
  });

  it('answers 400 without a session', async () => {
    const routes = await loadRoutes();
    const reply = replyDouble();

    await routes['POST /:listingId/apply']({ params: { listingId: 'abc' }, session: {} }, reply);

    expect(reply.recorded.status).toBe(400);
  });

  it('answers 500 when the automation throws', async () => {
    const routes = await loadRoutes();
    startError = new Error('browser crashed');
    const reply = replyDouble();

    await routes['POST /:listingId/apply']({ params: { listingId: 'abc' }, session: { currentUser: 'user-1' } }, reply);

    expect(reply.recorded.status).toBe(500);
    expect(reply.recorded.payload).toEqual({ message: 'browser crashed' });
  });
});

describe('POST /api/listings/:listingId/apply/confirm', () => {
  it('closes the session and marks the listing as applied', async () => {
    const routes = await loadRoutes();
    const reply = replyDouble();

    await routes['POST /:listingId/apply/confirm'](
      { params: { listingId: 'abc' }, body: { sessionId: 'session-1' }, session: { currentUser: 'user-1' } },
      reply,
    );

    expect(confirmCalls).toEqual([{ sessionId: 'session-1', userId: 'user-1' }]);
    expect(statusCalls).toEqual([{ id: 'abc', status: 'applied' }]);
    expect(watchedIds).toEqual(['abc']);
    expect(tracked).toContain('APPLY_AUTOMATION_CONFIRMED');
    expect(reply.recorded.status).toBe(200);
  });

  it("answers 404 for a session that is gone or isn't the caller's", async () => {
    const routes = await loadRoutes();
    confirmResult = false;
    const reply = replyDouble();

    await routes['POST /:listingId/apply/confirm'](
      { params: { listingId: 'abc' }, body: { sessionId: 'session-1' }, session: { currentUser: 'user-1' } },
      reply,
    );

    expect(reply.recorded.status).toBe(404);
    expect(statusCalls).toHaveLength(0);
  });

  it('refuses a listing the user cannot access, without ever touching the session', async () => {
    const routes = await loadRoutes({ canAccess: false });
    const reply = replyDouble();

    await routes['POST /:listingId/apply/confirm'](
      { params: { listingId: 'abc' }, body: { sessionId: 'session-1' }, session: { currentUser: 'user-1' } },
      reply,
    );

    expect(reply.recorded.status).toBe(403);
    expect(confirmCalls).toHaveLength(0);
  });

  it('answers 400 without a sessionId', async () => {
    const routes = await loadRoutes();
    const reply = replyDouble();

    await routes['POST /:listingId/apply/confirm'](
      { params: { listingId: 'abc' }, body: {}, session: { currentUser: 'user-1' } },
      reply,
    );

    expect(reply.recorded.status).toBe(400);
  });
});
