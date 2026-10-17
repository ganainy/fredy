/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as immoscout from './immoscout.js';
import * as immowelt from './immowelt.js';

/**
 * The portals the apply-automation feature knows a contact form for.
 *
 * Deliberately a short, explicit list rather than "every provider" - see the carry-over plan this
 * implements: a portal's contact form has to be looked at by a person before Fredy fills it in, so
 * adding one here is a decision, not something a new `lib/provider/*.js` module should trigger on
 * its own.
 * @type {Record<string, {fields: import('../formFiller.js').FieldDescriptor[], openPhrases: string[], isPaywalled: (url: string) => boolean}>}
 */
const FORM_MAPS = {
  immoscout,
  immowelt,
};

/**
 * The form map for a provider id, or `null` when apply-automation does not support it.
 *
 * @param {string|null|undefined} providerId
 * @returns {{fields: import('../formFiller.js').FieldDescriptor[], openPhrases: string[], isPaywalled: (url: string) => boolean}|null}
 */
export function getFormMap(providerId) {
  return FORM_MAPS[providerId] ?? null;
}
