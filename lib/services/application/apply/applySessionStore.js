/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { randomUUID } from 'node:crypto';
import { closeBrowser } from '../../extractor/puppeteerExtractor.js';
import logger from '../../logger.js';

/**
 * The open apply-automation browser windows, between the request that opened one and the request
 * that confirms it was sent.
 *
 * In memory rather than in a table, the same reasoning as `jobDraftStore.js`'s interview state: a
 * live browser handle cannot be serialised into a database row at all, and losing one on a restart
 * costs the user one re-click of "Apply automatically", not a migration. Swept on access rather
 * than on a timer, also like that store - except a stale entry here is not a handful of plain
 * objects but an open Chromium window, so the sweep closes the browser rather than only dropping
 * the Map entry.
 */

/** How long an opened browser window waits for "Mark as sent" before it is closed on its own. */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * @typedef {Object} ApplySession
 * @property {import('puppeteer-core').Browser} browser
 * @property {import('puppeteer-core').Page} page
 * @property {string} listingId
 * @property {string} userId
 * @property {number} createdAt
 */

/** @type {Map<string, ApplySession>} */
const sessions = new Map();

/**
 * Closes and drops every session nobody confirmed in time.
 *
 * @param {number} [now=Date.now()]
 * @returns {Promise<void>}
 */
async function sweep(now = Date.now()) {
  const expired = [...sessions.entries()].filter(([, session]) => now - session.createdAt > SESSION_TTL_MS);
  for (const [sessionId, session] of expired) {
    sessions.delete(sessionId);
    logger.warn(`Apply automation: closing an apply browser window nobody confirmed within 30 minutes (${sessionId}).`);
    await closeBrowser(session.browser).catch(() => {});
  }
}

/**
 * Registers a freshly opened apply browser window.
 *
 * @param {Omit<ApplySession, 'createdAt'>} session
 * @returns {Promise<string>} The session id to hand back to the browser.
 */
export async function createSession(session) {
  await sweep();
  const sessionId = randomUUID();
  sessions.set(sessionId, { ...session, createdAt: Date.now() });
  return sessionId;
}

/**
 * The session a user is confirming, or `null` when it does not exist, has expired, or belongs to
 * someone else.
 *
 * Scoped by `userId` for the same reason every listing route is: a session id is as guessable as a
 * listing id, and closing a stranger's browser window on their screen would be worse than merely
 * reading their data.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @returns {Promise<ApplySession|null>}
 */
export async function getSession(sessionId, userId) {
  await sweep();
  const session = sessions.get(sessionId);
  return session != null && session.userId === userId ? session : null;
}

/**
 * Ends a session: closes its browser and drops it from the store. A no-op for a session that is
 * already gone, which is the ordinary case when "Mark as sent" is clicked a second time.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function endSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session == null) return;
  sessions.delete(sessionId);
  await closeBrowser(session.browser).catch(() => {});
}

/** Test seam. The store is module state; a test that did not clear it would leak into the next. */
export function _resetApplySessionsForTests() {
  sessions.clear();
}
