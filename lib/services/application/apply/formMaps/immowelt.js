/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Immowelt's contact form, field by field.
 *
 * Unlike ImmoScout24's, these field labels were not confirmed by hand against a live listing in
 * the session that wrote the carry-over plan this module implements - that session's manual runs
 * were all on ImmoScout24. What carried over from wohnungssuche (an Immowelt-only crawler) is that
 * the form sits behind a "Nachricht schreiben" button rather than showing inline, which
 * `openPhrases` exists to click through, and that Immowelt is one of the DataDome-protected portals
 * Fredy already has a `browserActivityProbe` for. The field names below are the common German
 * equivalents and best-effort `autocomplete` tokens; run a handful of real applications before
 * trusting this the way ImmoScout24's map can be trusted, and adjust `nameHints`/`labelText` here
 * against what the live form actually sends - `formFiller.js` degrades rather than fails on a
 * field it cannot find, so a wrong guess costs a warning, not a crash.
 *
 * @type {import('../formFiller.js').FieldDescriptor[]}
 */
export const fields = [
  { key: 'firstName', autocomplete: ['given-name'], nameHints: ['firstname', 'vorname'], labelText: ['vorname'] },
  { key: 'lastName', autocomplete: ['family-name'], nameHints: ['lastname', 'nachname'], labelText: ['nachname'] },
  { key: 'email', autocomplete: ['email'], nameHints: ['email', 'mail'], labelText: ['e-mail', 'email'] },
  { key: 'phone', autocomplete: ['tel'], nameHints: ['phone', 'telefon'], labelText: ['telefon'], optional: true },
  {
    key: 'message',
    type: 'text',
    nameHints: ['message', 'nachricht'],
    labelText: ['ihre nachricht', 'nachricht'],
  },
];

/**
 * Phrases that open the form when it is not already on the page.
 *
 * `"Nachricht schreiben"` specifically is wohnungssuche's own `find_form()` behaviour for this
 * portal, carried over rather than guessed.
 * @type {string[]}
 */
export const openPhrases = ['nachricht schreiben', 'kontaktieren'];

/**
 * Immowelt has no equivalent of ImmoScout24's "Suchen+" paywall at the time this was written.
 *
 * @param {string} _url
 * @returns {boolean}
 */
export function isPaywalled(_url) {
  return false;
}
