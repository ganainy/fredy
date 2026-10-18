/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

// Migration: whether contacting a listing needs a paid portal subscription.
//
// Some immowelt adverts are only contactable through a subscription: the exposé shows its contact
// button, but the page it opens says the advert is exclusive to members and no message can be sent
// without a paid account. That is a property of the advert, not of the reader, so it is recorded on
// the listing once and shown as a tag in the overview - a listing whose money and effort would be
// wasted is worth spotting before one invests either.
//
// `requires_subscription` is deliberately three-valued: 1 the gate was found, 0 the advert is
// contactable without one, NULL nobody has been able to tell yet. The background probe leaves it
// NULL when it cannot get an answer (a bot wall, a network failure) and `subscription_checked_at`
// then lets it try again after a while instead of re-probing on every run. A provider that declares
// no such probe leaves both columns empty and its listings read exactly as they did before.

export function up(db) {
  db.exec(`
    ALTER TABLE listings ADD COLUMN requires_subscription INTEGER;
    ALTER TABLE listings ADD COLUMN subscription_checked_at INTEGER;
  `);
}
