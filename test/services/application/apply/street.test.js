/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { splitStreetAndHouseNumber } from '../../../../lib/services/application/apply/street.js';

describe('services/application/apply/street', () => {
  it('splits a plain street and number', () => {
    expect(splitStreetAndHouseNumber('Musterstraße 12')).toEqual({ street: 'Musterstraße', houseNumber: '12' });
  });

  it('keeps a letter suffix with the number', () => {
    expect(splitStreetAndHouseNumber('Musterstraße 12a')).toEqual({ street: 'Musterstraße', houseNumber: '12a' });
  });

  it('keeps a hyphenated range with the number', () => {
    expect(splitStreetAndHouseNumber('Musterstraße 3-5')).toEqual({ street: 'Musterstraße', houseNumber: '3-5' });
  });

  it('copes with a multi-word street name', () => {
    expect(splitStreetAndHouseNumber('Am Alten Markt 7')).toEqual({ street: 'Am Alten Markt', houseNumber: '7' });
  });

  it('leaves the house number empty when none can be found', () => {
    expect(splitStreetAndHouseNumber('Musterstraße')).toEqual({ street: 'Musterstraße', houseNumber: '' });
  });

  it('treats missing input the same as an empty string', () => {
    expect(splitStreetAndHouseNumber(null)).toEqual({ street: '', houseNumber: '' });
    expect(splitStreetAndHouseNumber(undefined)).toEqual({ street: '', houseNumber: '' });
  });

  it('trims surrounding whitespace', () => {
    expect(splitStreetAndHouseNumber('  Musterstraße 12  ')).toEqual({ street: 'Musterstraße', houseNumber: '12' });
  });
});
