/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fetch from 'node-fetch';
import logger from '../logger.js';
import { getSettings } from '../storage/settingsStorage.js';

/**
 * Thin client for Google's Routes API (https://routes.googleapis.com), the one source Fredy asks
 * for a car time that models actual traffic. MOTIS, the free community service everything else
 * here goes through, says in its own documentation that it does not - "the trip is the same all
 * week" - which is a bad proxy for an actual commute. This is optional and keyed, unlike the rest
 * of `lib/services/transit/`, so it is never called unless an operator has set `googleMapsApiKey`.
 */
const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const REQUEST_TIMEOUT = 10000;

/** Mirrors `transitousClient.js`'s backoff: a rate limit is worth sitting out, not retrying. */
const PAUSE_DURATION = 900000; // 15 minutes

let last429 = 0;

/**
 * Whether the client is currently sitting out a rate limit.
 *
 * @returns {boolean}
 */
export function isGoogleRoutesPaused() {
  return Date.now() - last429 < PAUSE_DURATION;
}

/**
 * @typedef {Object} TrafficAwareRoute
 * @property {number} minutes - Door to door, including the modelled traffic.
 * @property {number|null} km - Driving distance, to one decimal place.
 * @property {string|null} geometry - Encoded polyline of the route, in the same format MOTIS uses.
 */

/**
 * Google answers a duration as a string like `"1234s"` rather than a number.
 *
 * @param {unknown} duration
 * @returns {number|null}
 */
function parseDurationSeconds(duration) {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(String(duration ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * One traffic-aware driving route between two coordinates.
 *
 * Returns `null` for every failure - no key configured, a paused rate limit, a network error, or
 * an answer with no usable route in it - so a caller never has to tell those apart from "there is
 * no route": it is only ever allowed to fall back to the traffic-blind figure, never to show
 * nothing where MOTIS already had an answer.
 *
 * @param {Object} params
 * @param {{lat: number, lng: number}} params.origin
 * @param {{lat: number, lng: number}} params.destination
 * @param {Date} params.departureTime - When the trip is modelled to start.
 * @param {'BEST_GUESS'|'PESSIMISTIC'|'OPTIMISTIC'} [params.trafficModel='BEST_GUESS']
 * @returns {Promise<TrafficAwareRoute|null>}
 */
export async function fetchTrafficAwareRoute({ origin, destination, departureTime, trafficModel = 'BEST_GUESS' }) {
  if (isGoogleRoutesPaused()) {
    return null;
  }

  let apiKey;
  try {
    apiKey = (await getSettings())?.googleMapsApiKey;
  } catch (error) {
    logger.error('Could not read googleMapsApiKey, skipping traffic-aware routing:', error);
    return null;
  }
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return null;
  }

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    departureTime: departureTime.toISOString(),
    trafficModel,
    computeAlternativeRoutes: false,
    units: 'METRIC',
  };

  try {
    const response = await fetch(ROUTES_API_URL, {
      method: 'POST',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey.trim(),
        // Asking for exactly the three fields this needs keeps every response small; Google bills
        // and rate-limits this endpoint separately from the ones that answer with more.
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      logger.warn('Google Routes API rate limit hit. Pausing traffic-aware routing for 15 minutes.');
      last429 = Date.now();
      return null;
    }
    if (!response.ok) {
      logger.error(`Google Routes API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const route = Array.isArray(data?.routes) ? data.routes[0] : null;
    const seconds = parseDurationSeconds(route?.duration);
    if (seconds == null) {
      return null;
    }
    return {
      minutes: Math.round(seconds / 60),
      km: Number.isFinite(route?.distanceMeters) ? Math.round(route.distanceMeters / 100) / 10 : null,
      geometry: typeof route?.polyline?.encodedPolyline === 'string' ? route.polyline.encodedPolyline : null,
    };
  } catch (error) {
    logger.error('Error during Google Routes request:', error);
    return null;
  }
}
