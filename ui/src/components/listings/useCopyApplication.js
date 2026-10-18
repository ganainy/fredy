/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { fetchApplicationLetter } from '../../services/applicationClient.js';
import { copyToClipboard } from '../../services/clipboard.js';
import { errorMessage } from '../../services/xhr.js';

/**
 * Draft a listing's application letter and put it on the clipboard without opening the dialog.
 *
 * The letter comes from the server, so the click has to survive an await. Browsers with
 * `ClipboardItem` accept a promise for the content, which keeps the write inside the gesture even in
 * Safari; the others fall back to fetching first and writing after, as `copyToClipboard` does.
 *
 * Unlike the dialog's "Copy and mark as applied" this only copies: the listing's status stays as it is.
 *
 * @returns {{ copy: (listingId: string) => Promise<void>, copying: boolean }}
 */
export function useCopyApplication() {
  const t = useTranslation();
  const [copying, setCopying] = useState(false);

  const copy = useCallback(
    async (listingId) => {
      setCopying(true);
      try {
        const letter = fetchApplicationLetter(listingId).then((result) => result.text);

        let copied = false;
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
          try {
            const blob = letter.then((text) => new Blob([text], { type: 'text/plain' }));
            await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
            copied = true;
          } catch (error) {
            console.warn('Clipboard item write refused, falling back to plain text.', error);
          }
        }
        if (!copied) copied = await copyToClipboard(await letter);

        if (copied) Toast.success(t('listing.application.copied'));
        else Toast.error(t('listing.application.copyError'));
      } catch (exception) {
        console.error('Error while trying to draft an application letter.', exception);
        Toast.error(errorMessage(exception, t('listing.application.loadError')));
      } finally {
        setCopying(false);
      }
    },
    [t],
  );

  return { copy, copying };
}
