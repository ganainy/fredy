/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const origin = { lat: 52.52, lng: 13.405 };
const destination = { lat: 52.5, lng: 13.42 };
const time = new Date('2026-08-03T06:30:00Z');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, statusText: `status ${status}`, json: async () => body };
}

async function loadClient(settings, fetchImpl) {
  vi.resetModules();
  const upsertSettings = vi.fn();
  vi.doMock('node-fetch', () => ({ default: vi.fn(fetchImpl) }));
  vi.doMock('../../../lib/services/storage/settingsStorage.js', () => ({
    getSettings: vi.fn().mockResolvedValue(settings),
    upsertSettings,
  }));
  const client = await import('../../../lib/services/transit/googleRoutesClient.js');
  return { ...client, upsertSettings };
}

beforeEach(() => {
  vi.doUnmock('node-fetch');
  vi.doUnmock('../../../lib/services/storage/settingsStorage.js');
});

describe('services/transit/googleRoutesClient (Google as routing provider)', () => {
  it('is only active when Google is chosen and a key is saved', async () => {
    const a = await loadClient({ routingProvider: 'google', googleMapsApiKey: 'k' }, vi.fn());
    expect(await a.isGoogleProviderActive()).toBe(true);
    const b = await loadClient({ routingProvider: 'transitous', googleMapsApiKey: 'k' }, vi.fn());
    expect(await b.isGoogleProviderActive()).toBe(false);
    const c = await loadClient({ routingProvider: 'google' }, vi.fn());
    expect(await c.isGoogleProviderActive()).toBe(false);
  });

  it('asks for public transport with an arrival time and counts the lookup', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { routes: [{ duration: '2400s', distanceMeters: 9000 }] }));
    const { fetchGoogleRoute, upsertSettings } = await loadClient({ googleMapsApiKey: 'secret' }, fetchImpl);

    const route = await fetchGoogleRoute({ origin, destination, mode: 'transit', time });

    expect(route).toEqual({ minutes: 40, km: 9, geometry: null });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.travelMode).toBe('TRANSIT');
    expect(body.arrivalTime).toBe(time.toISOString());
    expect(body.departureTime).toBeUndefined();
    expect(body.routingPreference).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].headers['X-Goog-Api-Key']).toBe('secret');
    expect(upsertSettings).toHaveBeenCalledWith({
      googleRoutesUsage: { month: new Date().toISOString().slice(0, 7), count: 1 },
    });
  });

  it('asks for a traffic-aware drive for the car', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { routes: [{ duration: '1200s' }] }));
    const { fetchGoogleRoute } = await loadClient({ googleMapsApiKey: 'k' }, fetchImpl);

    const route = await fetchGoogleRoute({ origin, destination, mode: 'car', time });

    expect(route.minutes).toBe(20);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_AWARE_OPTIMAL');
    expect(body.departureTime).toBe(time.toISOString());
  });

  it('stops asking Google once the monthly limit is reached', async () => {
    const fetchImpl = vi.fn();
    const month = new Date().toISOString().slice(0, 7);
    const { fetchGoogleRoute, upsertSettings } = await loadClient(
      { googleMapsApiKey: 'k', googleRoutesMonthlyLimit: 3, googleRoutesUsage: { month, count: 3 } },
      fetchImpl,
    );

    expect(await fetchGoogleRoute({ origin, destination, mode: 'transit', time })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(upsertSettings).not.toHaveBeenCalled();
  });

  it('starts counting again in a new month', async () => {
    const { readUsage } = await loadClient({}, vi.fn());
    const usage = readUsage({ googleRoutesMonthlyLimit: 100, googleRoutesUsage: { month: '2020-01', count: 99 } });
    expect(usage.count).toBe(0);
    expect(usage.limit).toBe(100);
  });

  it('returns null without a key and does not count', async () => {
    const fetchImpl = vi.fn();
    const { fetchGoogleRoute, upsertSettings } = await loadClient({}, fetchImpl);
    expect(await fetchGoogleRoute({ origin, destination, mode: 'car', time })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(upsertSettings).not.toHaveBeenCalled();
  });
});
