/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * ImmoScout24's contact form, field by field.
 *
 * The label text here is German, confirmed empirically by filling roughly nineteen real contact
 * forms by hand in the session that wrote the carry-over plan this module implements: Vorname,
 * Nachname, E-Mail, Straße, Hausnummer, Postleitzahl, Ort, and sometimes Einzugstermin,
 * Haushaltsgröße, Haustiere, Beschäftigungsart and Monatliches netto Haushaltseinkommen as
 * dropdowns. A redesign since then would silently drift this list; `formFiller.js` is built to
 * degrade rather than fail when that happens, and a listing behind a paid "Suchen+" subscription
 * never reaches this module at all - `applyService.js` detects that redirect first.
 *
 * @type {import('../formFiller.js').FieldDescriptor[]}
 */
export const fields = [
  { key: 'firstName', autocomplete: ['given-name'], nameHints: ['firstname', 'vorname'], labelText: ['vorname'] },
  {
    key: 'lastName',
    autocomplete: ['family-name'],
    nameHints: ['lastname', 'surname', 'nachname'],
    labelText: ['nachname'],
  },
  { key: 'email', autocomplete: ['email'], nameHints: ['email', 'mail'], labelText: ['e-mail', 'email'] },
  { key: 'phone', autocomplete: ['tel'], nameHints: ['phone', 'telefon'], labelText: ['telefon'], optional: true },
  {
    key: 'street',
    autocomplete: ['address-line1'],
    nameHints: ['street', 'strasse', 'straße'],
    labelText: ['straße', 'strasse'],
  },
  { key: 'houseNumber', nameHints: ['housenumber', 'hausnummer'], labelText: ['hausnummer'] },
  {
    key: 'zip',
    autocomplete: ['postal-code'],
    nameHints: ['zip', 'postcode', 'plz', 'postleitzahl'],
    labelText: ['postleitzahl', 'plz'],
  },
  { key: 'city', autocomplete: ['address-level2'], nameHints: ['city', 'ort'], labelText: ['ort'] },
  { key: 'moveInDate', nameHints: ['movein', 'einzugstermin'], labelText: ['einzugstermin'], optional: true },
  {
    key: 'householdSize',
    type: 'select',
    nameHints: ['household', 'haushaltsgroesse', 'haushaltsgröße'],
    labelText: ['haushaltsgröße', 'anzahl personen'],
    optional: true,
  },
  { key: 'pets', type: 'select', nameHints: ['pets', 'haustiere'], labelText: ['haustiere'], optional: true },
  {
    key: 'employmentType',
    type: 'select',
    nameHints: ['employment', 'beschaeftigungsart', 'beschäftigungsart'],
    labelText: ['beschäftigungsart'],
    optional: true,
  },
  {
    key: 'netIncome',
    nameHints: ['income', 'netto', 'haushaltseinkommen'],
    labelText: ['nettoeinkommen', 'haushaltseinkommen'],
    optional: true,
  },
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
 * Tried in order before looking for the fields above; a portal that already shows the form inline
 * simply never matches any of these, which costs nothing.
 * @type {string[]}
 */
export const openPhrases = ['nachricht schreiben', 'kontaktieren', 'nachricht senden'];

/**
 * A listing ImmoScout24 has paywalled behind its "Suchen+" subscription redirects to the shopping
 * cart for it instead of showing the contact form - a fact about the listing, not a failure of this
 * automation, so {@link applyService.js} surfaces it as its own outcome rather than "could not find
 * the form".
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isPaywalled(url) {
  return /\/warenkorb\/mieterplus\//.test(String(url ?? ''));
}
