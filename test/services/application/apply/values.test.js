/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { buildContactFormValues } from '../../../../lib/services/application/apply/values.js';

describe('services/application/apply/values', () => {
  it('maps the profile fields a contact form asks for', () => {
    const profile = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+49 30 1234567',
      street: 'Musterstraße 12a',
      zip: '10115',
      city: 'Berlin',
      moveInDate: '2026-09-01',
      adults: 2,
      children: 1,
      pets: 'a cat',
      employmentType: 'permanent',
      netIncome: 3200,
    };

    const values = buildContactFormValues(profile, 'Dear landlord, ...');

    expect(values).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+49 30 1234567',
      street: 'Musterstraße',
      houseNumber: '12a',
      zip: '10115',
      city: 'Berlin',
      moveInDate: '01.09.2026',
      householdSize: '3',
      pets: 'Ja',
      employmentType: 'Angestellt',
      netIncome: '3200',
      message: 'Dear landlord, ...',
    });
  });

  it('recognises common ways of saying there are no pets', () => {
    expect(buildContactFormValues({ pets: 'keine' }, '').pets).toBe('Nein');
    expect(buildContactFormValues({ pets: 'none' }, '').pets).toBe('Nein');
    expect(buildContactFormValues({ pets: '' }, '').pets).toBe('');
  });

  it('leaves every field empty for a profile that was never filled in', () => {
    const values = buildContactFormValues(null, 'letter text');

    expect(values.firstName).toBe('');
    expect(values.street).toBe('');
    expect(values.houseNumber).toBe('');
    expect(values.householdSize).toBe('');
    expect(values.employmentType).toBe('');
    expect(values.netIncome).toBe('');
    // The letter itself is independent of the profile and is always carried through.
    expect(values.message).toBe('letter text');
  });

  it('falls back to an empty employment type for a value Fredy does not know', () => {
    expect(buildContactFormValues({ employmentType: 'freelancer-from-the-future' }, '').employmentType).toBe('');
  });
});
