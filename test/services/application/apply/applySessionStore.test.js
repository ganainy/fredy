/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../lib/services/extractor/puppeteerExtractor.js', () => ({
  closeBrowser: vi.fn().mockResolvedValue(undefined),
}));

import { closeBrowser } from '../../../../lib/services/extractor/puppeteerExtractor.js';
import {
  createSession,
  getSession,
  endSession,
  _resetApplySessionsForTests,
} from '../../../../lib/services/application/apply/applySessionStore.js';

const fakeBrowser = () => ({ id: Symbol('browser') });

beforeEach(() => {
  _resetApplySessionsForTests();
  vi.mocked(closeBrowser).mockClear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('services/application/apply/applySessionStore', () => {
  it('returns a session only to the user it belongs to', async () => {
    const browser = fakeBrowser();
    const sessionId = await createSession({ browser, page: {}, listingId: 'listing-1', userId: 'user-1' });

    expect(await getSession(sessionId, 'user-1')).not.toBeNull();
    expect(await getSession(sessionId, 'user-2')).toBeNull();
  });

  it('returns null for a session that was never created', async () => {
    expect(await getSession('does-not-exist', 'user-1')).toBeNull();
  });

  it('closes the browser and forgets the session once confirmed', async () => {
    const browser = fakeBrowser();
    const sessionId = await createSession({ browser, page: {}, listingId: 'listing-1', userId: 'user-1' });

    await endSession(sessionId);

    expect(closeBrowser).toHaveBeenCalledWith(browser);
    expect(await getSession(sessionId, 'user-1')).toBeNull();
  });

  it('does nothing when asked to end a session twice', async () => {
    const sessionId = await createSession({
      browser: fakeBrowser(),
      page: {},
      listingId: 'listing-1',
      userId: 'user-1',
    });
    await endSession(sessionId);
    vi.mocked(closeBrowser).mockClear();

    await expect(endSession(sessionId)).resolves.toBeUndefined();
    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it('closes an abandoned browser window on its own after the TTL', async () => {
    vi.useFakeTimers();
    const browser = fakeBrowser();
    const sessionId = await createSession({ browser, page: {}, listingId: 'listing-1', userId: 'user-1' });

    vi.advanceTimersByTime(31 * 60 * 1000);
    // The sweep runs on access, not on a timer of its own - the next call is what notices the
    // session is overdue.
    expect(await getSession(sessionId, 'user-1')).toBeNull();
    expect(closeBrowser).toHaveBeenCalledWith(browser);
  });

  it('leaves a session that is still within its TTL alone', async () => {
    vi.useFakeTimers();
    const browser = fakeBrowser();
    const sessionId = await createSession({ browser, page: {}, listingId: 'listing-1', userId: 'user-1' });

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(await getSession(sessionId, 'user-1')).not.toBeNull();
    expect(closeBrowser).not.toHaveBeenCalled();
  });
});
