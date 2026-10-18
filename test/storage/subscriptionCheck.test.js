/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * The subscription probe is a browser render per listing, so what the due query hands it is the
 * whole cost of a run. These tests pin that it asks only for the listings a capable provider owns,
 * only for the ones nobody has answered yet, and only for the unanswered ones whose retry window has
 * passed - the difference between a bounded nightly sweep and re-asking the same blocked listing
 * forever.
 */
describe('storage/listingsStorage subscription checks', () => {
  let db;
  let listingsStorage;

  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_800_000_000_000;
  const WEEK = 7 * DAY;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE listings (
        id TEXT PRIMARY KEY,
        provider TEXT,
        link TEXT,
        manually_deleted INTEGER DEFAULT 0,
        created_at INTEGER,
        requires_subscription INTEGER,
        subscription_checked_at INTEGER
      );
    `);

    vi.resetModules();
    vi.doMock('../../lib/services/storage/SqliteConnection.js', () => ({
      default: {
        getConnection: () => db,
        query: (sql, params) => db.prepare(sql).all(params),
        execute: (sql, params) => db.prepare(sql).run(params),
        withTransaction: (callback) => db.transaction(() => callback(db))(),
      },
    }));
    vi.doMock('../../lib/services/similarity-check/similarityCache.js', () => ({ removeEntry: () => {} }));
    listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  });

  afterEach(() => db.close());

  const addListing = (
    id,
    { provider = 'immowelt', link = `https://www.immowelt.de/expose/${id}`, deleted = 0, createdAt = NOW } = {},
  ) =>
    db
      .prepare(
        `INSERT INTO listings (id, provider, link, manually_deleted, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(id, provider, link, deleted, createdAt);

  const answer = (id, requires, checkedAt) =>
    db
      .prepare(`UPDATE listings SET requires_subscription = ?, subscription_checked_at = ? WHERE id = ?`)
      .run(requires, checkedAt, id);

  const due = (overrides = {}) =>
    listingsStorage
      .getListingsDueForSubscriptionCheck({ providerIds: ['immowelt'], now: NOW, retryAfterMs: WEEK, ...overrides })
      .map((row) => row.id);

  it('asks for a listing that has never been checked', () => {
    addListing('fresh');
    expect(due()).toEqual(['fresh']);
  });

  it('never asks for a provider that declares no probe', () => {
    addListing('immowelt-one', { provider: 'immowelt' });
    addListing('seloger-one', { provider: 'seloger' });
    expect(due()).toEqual(['immowelt-one']);
  });

  it('asks nothing when no provider is capable', () => {
    addListing('immowelt-one');
    expect(due({ providerIds: [] })).toEqual([]);
  });

  it('leaves a listing that already got an answer alone', () => {
    addListing('gated');
    addListing('open');
    answer('gated', 1, NOW - 400 * DAY);
    answer('open', 0, NOW - 400 * DAY);
    expect(due()).toEqual([]);
  });

  it('re-asks an unanswered listing only after the retry window', () => {
    addListing('blocked-long');
    addListing('blocked-fresh');
    answer('blocked-long', null, NOW - 8 * DAY);
    answer('blocked-fresh', null, NOW - 2 * DAY);
    expect(due()).toEqual(['blocked-long']);
  });

  it('skips a listing the user deleted and one without a link', () => {
    addListing('hidden', { deleted: 1 });
    addListing('no-link', { link: null });
    addListing('real');
    expect(due()).toEqual(['real']);
  });

  it('puts never-checked listings before the ones whose retry came round', () => {
    addListing('retry', { createdAt: NOW - 100 * DAY });
    answer('retry', null, NOW - 8 * DAY);
    addListing('never', { createdAt: NOW - 1 * DAY });
    expect(due()).toEqual(['never', 'retry']);
  });

  it('honours the per-run limit', () => {
    addListing('a', { createdAt: NOW - 3 * DAY });
    addListing('b', { createdAt: NOW - 2 * DAY });
    addListing('c', { createdAt: NOW - 1 * DAY });
    expect(due({ limit: 2 })).toEqual(['a', 'b']);
  });

  it('stores the tri-state answer and stamps the check time', () => {
    addListing('gated');
    addListing('open');
    addListing('unknown');

    listingsStorage.applySubscriptionCheck('gated', true, NOW);
    listingsStorage.applySubscriptionCheck('open', false, NOW);
    listingsStorage.applySubscriptionCheck('unknown', null, NOW);

    const rows = db
      .prepare(`SELECT id, requires_subscription, subscription_checked_at FROM listings ORDER BY id`)
      .all();
    expect(rows).toEqual([
      { id: 'gated', requires_subscription: 1, subscription_checked_at: NOW },
      { id: 'open', requires_subscription: 0, subscription_checked_at: NOW },
      { id: 'unknown', requires_subscription: null, subscription_checked_at: NOW },
    ]);
  });

  it('does nothing for a missing id', () => {
    expect(listingsStorage.applySubscriptionCheck(undefined, true, NOW)).toBeUndefined();
  });
});
