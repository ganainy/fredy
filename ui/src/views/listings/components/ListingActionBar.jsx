/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Button, Dropdown, Toast, Tooltip } from '@douyinfe/semi-ui-19';
import {
  IconChevronLeft,
  IconCopy,
  IconDelete,
  IconEdit,
  IconLink,
  IconMore,
  IconRefresh,
  IconSend,
  IconStar,
  IconStarStroked,
} from '@douyinfe/semi-icons';

import { providerName } from '../listingFacts.js';
import { useTranslation } from '../../../services/i18n/i18n.jsx';
import { startAutoApply, confirmAutoApply } from '../../../services/applicationClient.js';
import { errorMessage } from '../../../services/xhr.js';
import { useCopyApplication } from '../../../components/listings/useCopyApplication.js';
import './ListingActionBar.less';

/**
 * The one row of controls the detail page acts through.
 *
 * Every button on this page used to carry the same visual weight, so "copy application letter" and
 * "delete listing" sat in the same register and, on a narrow viewport, at the same width. The bar
 * now has exactly one solid button - writing the letter, which is what the reader came to do - a
 * pair of outlined secondaries either side of it, and the two destructive actions folded into an
 * overflow menu where a wrong click costs a second step rather than a listing.
 *
 * On phones the bar leaves the top of the page and fixes itself to the bottom edge, where the
 * primary action takes the full width: the thumb is there and the header is not.
 *
 * @param {Object} props
 * @param {Object} props.listing - The row being shown.
 * @param {() => void} props.onBack
 * @param {() => void} props.onWatch
 * @param {() => void} props.onApply - Opens the application letter dialog ("Edit application").
 * @param {() => void} [props.onApplied] - Called once "Mark as sent" has set the listing to applied.
 * @param {() => void} props.onDelete
 * @param {() => void} props.onReactivate
 * @returns {React.ReactElement}
 */
export default function ListingActionBar({ listing, onBack, onWatch, onApply, onApplied, onDelete, onReactivate }) {
  const t = useTranslation();
  const { copy, copying } = useCopyApplication();

  /** The apply-automation browser window, once "Apply automatically" has opened one for this listing. */
  const [applySessionId, setApplySessionId] = useState(null);
  const [applyBusy, setApplyBusy] = useState(false);
  // A session belongs to the listing it opened a browser window for.
  useEffect(() => setApplySessionId(null), [listing?.id]);

  /** Opens the real listing in a visible browser window and fills in its contact form. */
  const handleApplyAutomatically = async () => {
    setApplyBusy(true);
    try {
      const outcome = await startAutoApply(listing.id);
      if (!outcome.ok) {
        Toast.error(t(`listing.application.applyError.${outcome.reason}`));
        return;
      }
      setApplySessionId(outcome.sessionId);
      Toast.success(
        outcome.missing.length > 0
          ? t('listing.application.applyOpenedWithGaps', { count: outcome.missing.length })
          : t('listing.application.applyOpened'),
      );
    } catch (exception) {
      console.error('Error starting apply automation.', exception);
      Toast.error(errorMessage(exception, t('listing.application.applyError.launchFailed')));
    } finally {
      setApplyBusy(false);
    }
  };

  /** "Mark as sent": closes the browser window and records the listing as applied for. */
  const handleConfirmSent = async () => {
    setApplyBusy(true);
    try {
      await confirmAutoApply(listing.id, applySessionId);
      setApplySessionId(null);
      onApplied?.();
      Toast.success(t('listing.application.markedSent'));
    } catch (exception) {
      console.error('Error confirming apply automation.', exception);
      Toast.error(errorMessage(exception, t('listing.application.markFailed')));
    } finally {
      setApplyBusy(false);
    }
  };
  const watched = listing?.isWatched === 1;
  const watchLabel = watched ? t('listing.detail.watched') : t('listing.detail.watch');
  // Naming the portal turns "open listing" from a promise into a destination, which matters for a
  // link that leaves the app.
  const openLabel = listing?.provider
    ? t('listing.detail.openInPortal', { portal: providerName(listing.provider) })
    : t('listing.detail.openListing');

  const overflow = (
    <Dropdown.Menu>
      {listing?.is_active === 0 && (
        <Dropdown.Item icon={<IconRefresh />} onClick={onReactivate}>
          {t('listing.detail.reactivate')}
        </Dropdown.Item>
      )}
      <Dropdown.Item icon={<IconDelete />} type="danger" onClick={onDelete}>
        {t('listing.detail.delete')}
      </Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <div className="listing-actionbar">
      <Button
        className="listing-actionbar__back"
        icon={<IconChevronLeft />}
        onClick={onBack}
        theme="borderless"
        aria-label={t('listing.detail.back')}
      >
        <span className="listing-actionbar__back-label">{t('listing.detail.back')}</span>
      </Button>

      <div className="listing-actionbar__spacer" />

      <Tooltip content={watchLabel} position="bottom">
        <Button
          icon={watched ? <IconStar /> : <IconStarStroked />}
          onClick={onWatch}
          theme="borderless"
          aria-label={watchLabel}
          aria-pressed={watched}
          className={`listing-actionbar__watch${watched ? ' listing-actionbar__watch--active' : ''}`}
        />
      </Tooltip>

      <a
        href={listing?.link}
        target="_blank"
        rel="noopener noreferrer"
        className="listing-actionbar__open"
        title={openLabel}
      >
        <IconLink />
        <span className="listing-actionbar__open-label">{openLabel}</span>
      </a>

      {/* clickToHide, because Semi's Dropdown does not close itself: without it the menu stayed
          open on top of the deletion dialog it had just opened, and the only way out was a click
          somewhere else. Same fix, same reason as ListingActions, JobActions and MapPopupActions. */}
      <Dropdown trigger="click" position="bottomRight" clickToHide render={overflow}>
        <Button
          icon={<IconMore />}
          theme="borderless"
          aria-label={t('listing.detail.moreActions')}
          className="listing-actionbar__more"
        />
      </Dropdown>

      <span className="listing-actionbar__divider" aria-hidden="true" />

      {applySessionId == null ? (
        <Button
          className="listing-actionbar__auto"
          icon={<IconSend />}
          loading={applyBusy}
          disabled={applyBusy}
          onClick={handleApplyAutomatically}
        >
          {t('listing.application.applyAutomatically')}
        </Button>
      ) : (
        <Button
          className="listing-actionbar__auto"
          type="primary"
          loading={applyBusy}
          disabled={applyBusy}
          onClick={handleConfirmSent}
        >
          {t('listing.application.markAsSent')}
        </Button>
      )}

      <Button className="listing-actionbar__edit" icon={<IconEdit />} onClick={onApply}>
        {t('listing.application.edit')}
      </Button>

      <Button
        className="listing-actionbar__primary"
        icon={<IconCopy />}
        loading={copying}
        onClick={() => copy(listing?.id)}
        theme="solid"
        type="primary"
      >
        {t('listing.application.action')}
      </Button>
    </div>
  );
}

ListingActionBar.displayName = 'ListingActionBar';
