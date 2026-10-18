/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * One shared server-sent-events connection per browser tab.
 *
 * Browsers allow six HTTP/1.1 connections per host and port, and an open EventSource holds one for
 * as long as it lives. The notification hook, the job grid and the listings overview each opened
 * their own, so two or three Fredy tabs used up the whole budget and every further request - a
 * delete, a page load - queued forever with nothing on screen saying why.
 *
 * Here every subscriber shares the tab's single connection, and a tab that is not visible lets it
 * go: a background tab does not need live updates and must not keep a socket another tab could use.
 * It reconnects when the tab is shown again.
 */

const URL = '/api/jobs/events';

/** @type {EventSource|null} */
let source = null;
/** @type {Map<string, Set<(event: MessageEvent) => void>>} */
const handlers = new Map();

function isVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function attach(eventName) {
  source?.addEventListener(eventName, dispatch(eventName));
}

/** @type {Map<string, (event: MessageEvent) => void>} */
const dispatchers = new Map();

function dispatch(eventName) {
  let fn = dispatchers.get(eventName);
  if (fn == null) {
    fn = (event) => handlers.get(eventName)?.forEach((handler) => handler(event));
    dispatchers.set(eventName, fn);
  }
  return fn;
}

function open() {
  if (source != null || handlers.size === 0 || !isVisible()) return;
  source = new EventSource(URL);
  for (const eventName of handlers.keys()) attach(eventName);
}

function close() {
  source?.close();
  source = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (isVisible()) open();
    else close();
  });
}

/**
 * Listen to one named event of the job stream.
 *
 * @param {string} eventName e.g. `jobStatus`, `listings:new`, `notification:browser`
 * @param {(event: MessageEvent) => void} handler
 * @returns {() => void} unsubscribe; the connection closes with the last subscriber
 */
export function subscribeJobEvents(eventName, handler) {
  let set = handlers.get(eventName);
  if (set == null) {
    set = new Set();
    handlers.set(eventName, set);
    attach(eventName);
  }
  set.add(handler);
  open();

  return () => {
    const current = handlers.get(eventName);
    current?.delete(handler);
    if (current?.size === 0) {
      handlers.delete(eventName);
      source?.removeEventListener(eventName, dispatch(eventName));
    }
    if (handlers.size === 0) close();
  };
}
