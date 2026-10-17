/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { getFormMap } from '../../../../lib/services/application/apply/formMaps/index.js';
import { isPaywalled } from '../../../../lib/services/application/apply/formMaps/immoscout.js';

describe('services/application/apply/formMaps', () => {
  it('knows ImmoScout24 and Immowelt', () => {
    expect(getFormMap('immoscout')).not.toBeNull();
    expect(getFormMap('immowelt')).not.toBeNull();
  });

  it('has no map for a portal apply-automation does not support', () => {
    expect(getFormMap('kleinanzeigen')).toBeNull();
    expect(getFormMap(null)).toBeNull();
    expect(getFormMap(undefined)).toBeNull();
  });

  it('every field descriptor carries a key and at least one way of finding it', () => {
    for (const providerId of ['immoscout', 'immowelt']) {
      const map = getFormMap(providerId);
      for (const field of map.fields) {
        expect(field.key, providerId).toBeTypeOf('string');
        const hasLocator =
          (field.autocomplete?.length ?? 0) + (field.nameHints?.length ?? 0) + (field.labelText?.length ?? 0) > 0;
        expect(hasLocator, `${providerId}.${field.key}`).toBe(true);
      }
    }
  });
});

describe('services/application/apply/formMaps/immoscout isPaywalled', () => {
  it('recognises the Suchen+ redirect', () => {
    expect(isPaywalled('https://www.immobilienscout24.de/warenkorb/mieterplus/123')).toBe(true);
  });

  it('leaves an ordinary listing page alone', () => {
    expect(isPaywalled('https://www.immobilienscout24.de/expose/123456789')).toBe(false);
  });

  it('copes with a missing url', () => {
    expect(isPaywalled(null)).toBe(false);
    expect(isPaywalled(undefined)).toBe(false);
  });
});
