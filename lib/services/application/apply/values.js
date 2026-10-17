/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { splitStreetAndHouseNumber } from './street.js';

/**
 * Builds the flat `{key: value}` map every form map's descriptors are filled from.
 *
 * One function for every portal rather than one per formMap, because the source is the same
 * applicant profile either way - only which of these values a given portal's form actually asks
 * for differs, and that is the formMap's own job to decide.
 */

/**
 * German option text for each of Fredy's employment-type values.
 *
 * Deliberately German regardless of the interface's own language: the form being filled is on a
 * German portal, in German, whatever language the person operating Fredy reads it in.
 * @type {Record<string, string>}
 */
const EMPLOYMENT_TYPE_DE = {
  permanent: 'Angestellt',
  temporary: 'Befristet beschäftigt',
  selfEmployed: 'Selbstständig',
  civilServant: 'Beamter',
  student: 'Student',
  retired: 'Rentner',
};

/**
 * Words that mean "no pets" in whatever free text a user wrote into the profile's `pets` field.
 *
 * The field is prose ("a cat", "none") rather than a flag - see `placeholders.js` - but a portal's
 * own dropdown is usually a plain yes/no, so this is the best this can do without asking the user
 * to answer the same question twice in two different shapes.
 * @type {RegExp}
 */
const NO_PETS = /^(keine?|nein|no|none)$/i;

/**
 * @param {unknown} value - `YYYY-MM-DD`, or anything else, passed through unchanged.
 * @returns {string} `DD.MM.YYYY` when the input was a bare ISO date.
 */
function germanDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value ?? '').trim();
}

/**
 * @param {Object|null} profile - The stored `applicant_profile`.
 * @param {string} letterText - The already-rendered application letter.
 * @returns {Record<string, string>}
 */
export function buildContactFormValues(profile, letterText) {
  const { street, houseNumber } = splitStreetAndHouseNumber(profile?.street);
  const adults = Number(profile?.adults) || 0;
  const children = Number(profile?.children) || 0;
  const householdSize = adults + children;
  const pets = String(profile?.pets ?? '').trim();

  return {
    firstName: String(profile?.firstName ?? '').trim(),
    lastName: String(profile?.lastName ?? '').trim(),
    email: String(profile?.email ?? '').trim(),
    phone: String(profile?.phone ?? '').trim(),
    street,
    houseNumber,
    zip: String(profile?.zip ?? '').trim(),
    city: String(profile?.city ?? '').trim(),
    moveInDate: germanDate(profile?.moveInDate),
    householdSize: householdSize > 0 ? String(householdSize) : '',
    pets: pets.length === 0 ? '' : NO_PETS.test(pets) ? 'Nein' : 'Ja',
    employmentType: EMPLOYMENT_TYPE_DE[profile?.employmentType] ?? '',
    netIncome:
      Number.isFinite(Number(profile?.netIncome)) && profile?.netIncome !== ''
        ? String(Math.round(Number(profile.netIncome)))
        : '',
    message: String(letterText ?? ''),
  };
}
