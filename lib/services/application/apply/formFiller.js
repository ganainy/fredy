/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../../logger.js';

/**
 * Fills a contact form field by field, degrading gracefully.
 *
 * No two portals name their fields the same way, and a portal can rename one between one run and
 * the next without telling anyone. A field this cannot find is a warning, never a thrown error -
 * the human who opened this browser window sees the half-filled form and finishes it by hand,
 * which is strictly better than a crash that leaves them with nothing.
 */

/**
 * @typedef {Object} FieldDescriptor
 * @property {string} key - Matches a key in the values object passed to {@link fillForm}.
 * @property {'text'|'select'} [type='text']
 * @property {string[]} [autocomplete] - `autocomplete` token candidates (e.g. `given-name`), tried
 *   first because they are the one naming convention European forms tend to agree on regardless of
 *   language.
 * @property {string[]} [nameHints] - Case-insensitive substrings tried against `name`/`id`.
 * @property {string[]} [labelText] - Visible label text to match against, case-insensitive.
 * @property {boolean} [optional=false] - A missing optional field is not reported as a gap.
 */

/**
 * Locates one form field inside the page, trying every signal a descriptor offers in order of how
 * much it tends to survive a redesign: `autocomplete` first, then `name`/`id`, then the label a
 * human actually reads. Runs entirely inside the page so no handle has to cross the CDP boundary
 * before it has something worth returning.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {FieldDescriptor} descriptor
 * @returns {Promise<import('puppeteer-core').ElementHandle|null>}
 */
export async function findField(page, descriptor) {
  const handle = await page.evaluateHandle(
    (autocompleteTokens, nameHints, labelTexts) => {
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
      };
      const candidates = Array.from(document.querySelectorAll('input, select, textarea')).filter(visible);

      for (const token of autocompleteTokens ?? []) {
        const match = candidates.find((el) => (el.getAttribute('autocomplete') ?? '').toLowerCase() === token);
        if (match) return match;
      }

      for (const hint of nameHints ?? []) {
        const needle = hint.toLowerCase();
        const match = candidates.find((el) => {
          const name = (el.getAttribute('name') ?? '').toLowerCase();
          const id = (el.getAttribute('id') ?? '').toLowerCase();
          return name.includes(needle) || id.includes(needle);
        });
        if (match) return match;
      }

      const labelsOf = (el) => {
        const texts = [];
        if (el.id) {
          const explicit = document.querySelector(`label[for="${el.id}"]`);
          if (explicit) texts.push(explicit.textContent ?? '');
        }
        const wrapping = el.closest('label');
        if (wrapping) texts.push(wrapping.textContent ?? '');
        if (el.getAttribute('aria-label')) texts.push(el.getAttribute('aria-label'));
        if (el.placeholder) texts.push(el.placeholder);
        return texts.join(' ').toLowerCase();
      };
      for (const wanted of labelTexts ?? []) {
        const needle = wanted.toLowerCase();
        const match = candidates.find((el) => labelsOf(el).includes(needle));
        if (match) return match;
      }

      return null;
    },
    descriptor.autocomplete ?? [],
    descriptor.nameHints ?? [],
    descriptor.labelText ?? [],
  );

  const element = handle.asElement();
  if (element == null) {
    await handle.dispose();
    return null;
  }
  return element;
}

/**
 * Clears whatever an input already holds and types the new value as a human would.
 *
 * The clearing matters on its own: ImmoScout24 was seen carrying a previous listing's name and
 * email forward in the same browser profile, so typing without first selecting everything appended
 * onto stale text instead of replacing it.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {import('puppeteer-core').ElementHandle} element
 * @param {string} value
 * @returns {Promise<void>}
 */
async function clearAndType(page, element, value) {
  await element.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await element.type(String(value), { delay: 20 + Math.round(Math.random() * 40) });
}

/**
 * Picks the `<select>` option whose visible text best matches the wanted value, rather than
 * requiring the caller to know the option's `value` attribute - which is exactly the part of a
 * dropdown that differs between portals and changes without notice.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {import('puppeteer-core').ElementHandle} element
 * @param {string} wanted
 * @returns {Promise<boolean>} Whether an option was found and selected.
 */
async function selectClosestOption(page, element, wanted) {
  const optionValue = await element.evaluate((select, text) => {
    const needle = String(text).toLowerCase();
    const options = Array.from(select.options ?? []);
    const exact = options.find((option) => option.textContent?.trim().toLowerCase() === needle);
    const partial = options.find((option) => option.textContent?.toLowerCase().includes(needle));
    const picked = exact ?? partial;
    return picked ? picked.value : null;
  }, wanted);
  if (optionValue == null) return false;
  await element.select(optionValue);
  return true;
}

/**
 * Fills every field a provider's form map knows about, from a flat `{key: value}` map.
 *
 * Never throws for a field it cannot find or fill - see the module doc - so one unexpected portal
 * change degrades to a partially filled form rather than an apply flow that errors out before the
 * human ever sees the browser window.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {FieldDescriptor[]} descriptors
 * @param {Record<string, string|undefined>} values
 * @returns {Promise<{filled: string[], missing: string[]}>}
 */
export async function fillForm(page, descriptors, values) {
  const filled = [];
  const missing = [];

  for (const descriptor of descriptors) {
    const value = values[descriptor.key];
    if (value == null || String(value).trim().length === 0) {
      continue;
    }

    let element;
    try {
      element = await findField(page, descriptor);
      if (element == null) {
        if (!descriptor.optional) {
          logger.warn(`Apply automation: could not find the "${descriptor.key}" field on the contact form.`);
          missing.push(descriptor.key);
        }
        continue;
      }

      if (descriptor.type === 'select') {
        const picked = await selectClosestOption(page, element, String(value));
        if (!picked) {
          logger.warn(`Apply automation: no option matching "${value}" for the "${descriptor.key}" field.`);
          missing.push(descriptor.key);
          continue;
        }
      } else {
        await clearAndType(page, element, String(value));
      }
      filled.push(descriptor.key);
    } catch (error) {
      logger.warn(`Apply automation: could not fill the "${descriptor.key}" field.`, error);
      missing.push(descriptor.key);
    } finally {
      await element?.dispose();
    }
  }

  return { filled, missing };
}

/**
 * Clicks the first button or link whose own text contains one of the given phrases.
 *
 * Several portals keep the contact form behind a "write a message" button rather than showing it
 * inline, and which portal does which has changed before and will again. Trying this unconditionally
 * and moving on when nothing matches costs nothing on a portal that shows the form directly.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string[]} phrases - Case-insensitive, matched as a substring of the control's own text.
 * @returns {Promise<boolean>} Whether something was found and clicked.
 */
export async function clickButtonContaining(page, phrases) {
  const handle = await page.evaluateHandle((wanted) => {
    const controls = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    };
    for (const phrase of wanted) {
      const needle = phrase.toLowerCase();
      const match = controls.find((el) => visible(el) && (el.textContent ?? '').toLowerCase().includes(needle));
      if (match) return match;
    }
    return null;
  }, phrases);

  const element = handle.asElement();
  if (element == null) {
    await handle.dispose();
    return false;
  }
  try {
    await element.click();
    return true;
  } catch (error) {
    logger.warn('Apply automation: found a button to open the contact form but could not click it.', error);
    return false;
  } finally {
    await element.dispose();
  }
}
