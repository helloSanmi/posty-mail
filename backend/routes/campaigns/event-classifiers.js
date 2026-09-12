// Event-name classifiers for the metrics endpoints.
//
// These used to be a hand-kept copy of the UI's sets, held in lockstep by a
// test that parsed both files. They now delegate to shared/eventNames.js, so
// there is one definition and nothing to keep in step — and, more to the
// point, one place that knows Brevo spells the same event two different ways
// depending on whether it arrived by webhook or by API.
import {
  isBounceEvent, isClickEvent, isOpenEvent,
} from '../../../shared/eventNames.js';

export const isOpen = isOpenEvent;
export const isClick = isClickEvent;
export const isBounce = isBounceEvent;
