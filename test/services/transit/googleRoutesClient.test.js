/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const origin = { lat: 52.52, lng: 13.405 };
const destination = { lat: 52.5, lng: 13.42 };
const departureTime = new Date('2026-08-03T06:30:00Z');

/**
 * A minimal fetch Response stand-in, built the same way the other client tests build one.
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {{ok: boolean, status: number, statusText: string, json: () => Promise<unknown>}}
 */
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, statusText: `status ${status}`, json: async () => body };
}

/**
 * Loads a fresh copy of the client, with its own `last429` module state - the 15 minute pause
 * after a rate limit is real wall-clock time, so without this one test's 429 would silently empty
 * out every later test in the file.
 *
 * @param {Record<string, unknown>} settings
 * @param {(url: string, init: Object) => Promise<unknown>} fetchImpl
 * @returns {Promise<typeof import('../../../lib/services/transit/googleRoutesClient.js')>}
 */
async function loadClient(settings, fetchImpl) {
  vi.resetModules();
  vi.doMock('node-fetch', () => ({ default: vi.fn(fetchImpl) }));
  vi.doMock('../../../lib/services/storage/settingsStorage.js', () => ({
    getSettings: vi.fn().mockResolvedValue(settings),
  }));
  return import('../../../lib/services/transit/googleRoutesClient.js');
}

beforeEach(() => {
  vi.doUnmock('node-fetch');
  vi.doUnmock('../../../lib/services/storage/settingsStorage.js');
});

describe('services/transit/googleRoutesClient', () => {
  it('never asks Google when no key is configured', async () => {
    const fetchImpl = vi.fn();
    const { fetchTrafficAwareRoute } = await loadClient({}, fetchImpl);

    const route = await fetchTrafficAwareRoute({ origin, destination, departureTime });

    expect(route).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks for a traffic-aware route with the configured key and parses the answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response(200, {
        routes: [{ duration: '1830s', distanceMeters: 12345, polyline: { encodedPolyline: 'abc123' } }],
      }),
    );
    const { fetchTrafficAwareRoute } = await loadClient({ googleMapsApiKey: ' secret-key ' }, fetchImpl);

    const route = await fetchTrafficAwareRoute({ origin, destination, departureTime });

    expect(route).toEqual({ minutes: 31, km: 12.3, geometry: 'abc123' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    // Trimmed, so a key pasted with surrounding whitespace is not sent broken.
    expect(init.headers['X-Goog-Api-Key']).toBe('secret-key');
    const body = JSON.parse(init.body);
    expect(body.origin.location.latLng).toEqual({ latitude: origin.lat, longitude: origin.lng });
    expect(body.departureTime).toBe(departureTime.toISOString());
    expect(body.routingPreference).toBe('TRAFFIC_AWARE_OPTIMAL');
  });

  it('returns null when the answer carries no usable route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { routes: [] }));
    const { fetchTrafficAwareRoute } = await loadClient({ googleMapsApiKey: 'key' }, fetchImpl);

    expect(await fetchTrafficAwareRoute({ origin, destination, departureTime })).toBeNull();
  });

  it('returns null rather than throwing when the request itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const { fetchTrafficAwareRoute } = await loadClient({ googleMapsApiKey: 'key' }, fetchImpl);

    await expect(fetchTrafficAwareRoute({ origin, destination, departureTime })).resolves.toBeNull();
  });

  it('returns null and pauses future requests on a rate limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(429, {}));
    const { fetchTrafficAwareRoute, isGoogleRoutesPaused } = await loadClient({ googleMapsApiKey: 'key' }, fetchImpl);

    expect(await fetchTrafficAwareRoute({ origin, destination, departureTime })).toBeNull();
    expect(isGoogleRoutesPaused()).toBe(true);

    // Sitting out the pause: a second call must not even reach the network.
    fetchImpl.mockClear();
    expect(await fetchTrafficAwareRoute({ origin, destination, departureTime })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
