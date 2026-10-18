/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Open an in-app route in a new browser tab. The app mounts a HashRouter, so the route lives
 * behind the `#` of the current page.
 *
 * @param {string} route the route, e.g. `/listings/listing/42`
 */
export function openInNewTab(route) {
  const { origin, pathname, search } = window.location;
  window.open(`${origin}${pathname}${search}#${route}`, '_blank', 'noopener');
}
