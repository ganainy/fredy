/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Splits a street line into the street name and the house number.
 *
 * The applicant profile keeps one `street` field - see `placeholders.js`, which only ever reads it
 * as a whole for the letter - but ImmoScout24's contact form asks for "Straße" and "Hausnummer" as
 * two separate fields. A German house number is the trailing token and may carry a letter suffix
 * ("12a", "3-5"), so it is taken to be everything from the last run of digits onward.
 *
 * @param {string} street - e.g. `"Musterstraße 12a"`.
 * @returns {{street: string, houseNumber: string}} `houseNumber` is `''` when none could be found,
 *   in which case `street` is the input unchanged.
 */
export function splitStreetAndHouseNumber(street) {
  const trimmed = String(street ?? '').trim();
  const match = /^(.*\S)\s+(\d[\d\s/-]*[a-zA-Z]?)$/.exec(trimmed);
  if (!match) {
    return { street: trimmed, houseNumber: '' };
  }
  return { street: match[1].trim(), houseNumber: match[2].trim() };
}
