/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tooltip } from '@douyinfe/semi-ui-19';
import { IconLock } from '@douyinfe/semi-icons';

import { useTranslation } from '../../services/i18n/i18n.jsx';

import './SubscriptionBadge.less';

/**
 * The tag on a listing that can only be contacted through a paid portal subscription.
 *
 * Some immowelt adverts show their contact button like any other, but the page behind it says the
 * advert is exclusive to members: no message can be sent without a paid account. That is worth
 * knowing before one spends an evening on a listing one cannot apply for, so the chip sits on the
 * card, in the table row and on the detail page's headline.
 *
 * It is a fact, not a judgement, which is why it is neither red like the scam warning nor a state
 * the reader sets. It renders only when the background probe found the gate - a listing nobody has
 * been able to check (`requires_subscription` still null) carries nothing rather than a guess.
 *
 * @param {Object} props
 * @param {Object|null} props.listing A row as the listings API returns it.
 * @param {'inline'|'onImage'} [props.variant='inline'] `onImage` carries its own opaque panel for
 *   the card's photograph; `inline` sits on a surface.
 * @returns {React.ReactElement|null}
 */
export default function SubscriptionBadge({ listing, variant = 'inline' }) {
  const t = useTranslation();

  if (listing?.requires_subscription !== 1) {
    return null;
  }

  return (
    <Tooltip content={t('listings.subscriptionRequiredTooltip')} position="top">
      <span className={`subscriptionBadge subscriptionBadge--${variant}`}>
        <IconLock size="small" aria-hidden="true" />
        {t('listings.subscriptionRequired')}
      </span>
    </Tooltip>
  );
}

SubscriptionBadge.displayName = 'SubscriptionBadge';
