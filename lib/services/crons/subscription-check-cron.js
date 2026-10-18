/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import cron from 'node-cron';
import runSubscriptionChecker from '../listings/subscriptionCheckService.js';
import logger from '../logger.js';

/**
 * Every two hours, at a minute the other browser crons do not use.
 *
 * The checker probes a bounded slice per run, so a large database needs a few runs to work through;
 * the cron only decides how often Fredy *looks* for work. The odd minute (37) keeps it clear of the
 * alive-checker's top-of-hour slots and the price tracker's 05:00, so two Chromium renders are never
 * asked of the same instance at once. A gate does not change over a listing's life, so the interval
 * is about coverage of new listings, not freshness.
 * @type {string}
 */
const SUBSCRIPTION_CHECK_CRON = '37 */2 * * *';

/** Guard against a slow run still being in flight when the next tick fires. */
let running = false;

/**
 * Probe the due listings for a members-only gate.
 *
 * Never throws: a failed sweep costs one cycle of coverage and must not take a scheduled task down.
 *
 * @returns {Promise<void>}
 */
async function runTask() {
  if (running) {
    logger.debug('Subscription checker still running. Skipping this tick.');
    return;
  }
  running = true;
  try {
    await runSubscriptionChecker();
  } catch (err) {
    logger.warn('Subscription checker failed', err);
  } finally {
    running = false;
  }
}

/**
 * Schedule the subscription checker.
 *
 * Deliberately *not* run on start, like the price tracker: it launches a browser and renders
 * exposés, and doing that while the instance is still coming up would make every restart the
 * heaviest moment of the day.
 *
 * @returns {void}
 */
export function initSubscriptionCheckCron() {
  cron.schedule(SUBSCRIPTION_CHECK_CRON, runTask);
}
