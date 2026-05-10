import { useEffect, useId, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

// Lightweight date+time picker. Renders a trigger button with the current
// selection, opens a popover with a calendar grid + hour/minute selects.
// Avoids the browser-native `datetime-local` look (which varies wildly across
// browsers) without pulling in a heavyweight datepicker dependency.
//
// Value is the same `YYYY-MM-DDTHH:MM` local-time string `datetime-local`
// uses, so existing form state and toLocalInput() helpers continue to work.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function DateTimePicker({ value, onChange, min }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const labelId = useId();

  const parsed = parseLocal(value);
  const minParsed = parseLocal(min);
  const today = new Date();

  // Month displayed in the grid. Tracks the selected date initially, then the
  // user can page months without disturbing the actual selection.
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parsed || today;
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function commit(next) {
    onChange(formatLocal(next));
  }

  function handleDayClick(day) {
    if (minParsed && stripTime(day) < stripTime(minParsed)) return;
    const base = parsed || new Date();
    const next = new Date(day);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    if (minParsed && next < minParsed) {
      // Bump time forward to satisfy the min constraint on the same day.
      next.setHours(minParsed.getHours(), minParsed.getMinutes(), 0, 0);
    }
    commit(next);
  }

  function handleHourChange(value) {
    const base = parsed || new Date();
    const next = new Date(base);
    next.setHours(Number(value), base.getMinutes(), 0, 0);
    if (minParsed && next < minParsed) return;
    commit(next);
  }

  function handleMinuteChange(value) {
    const base = parsed || new Date();
    const next = new Date(base);
    next.setHours(base.getHours(), Number(value), 0, 0);
    if (minParsed && next < minParsed) return;
    commit(next);
  }

  return (
    <div className="dtp" ref={ref}>
      <button
        type="button"
        className="dtp-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={labelId}
      >
        <Calendar size={14} aria-hidden="true" />
        <span className="dtp-trigger-text" id={labelId}>
          {parsed ? formatHuman(parsed) : 'Choose a date and time'}
        </span>
      </button>
      {open && (
        <div className="dtp-popover" role="dialog" aria-label="Choose date and time">
          <div className="dtp-month-head">
            <button
              type="button"
              className="dtp-month-nav"
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <strong>{formatMonth(viewMonth)}</strong>
            <button
              type="button"
              className="dtp-month-nav"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              aria-label="Next month"
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="dtp-grid" role="grid">
            <div className="dtp-weekrow" role="row">
              {WEEKDAYS.map((wd) => (
                <span key={wd} className="dtp-weekday" role="columnheader">{wd}</span>
              ))}
            </div>
            {buildMonthCells(viewMonth).map((cell) => {
              if (!cell) return <span key={Math.random()} className="dtp-day is-blank" />;
              const isSelected = parsed && sameDay(cell, parsed);
              const isToday = sameDay(cell, today);
              const isDisabled = minParsed && stripTime(cell) < stripTime(minParsed);
              const className = [
                'dtp-day',
                isSelected ? 'is-selected' : '',
                isToday ? 'is-today' : '',
                isDisabled ? 'is-disabled' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={cell.toISOString()}
                  type="button"
                  className={className}
                  onClick={() => handleDayClick(cell)}
                  disabled={isDisabled}
                  aria-pressed={isSelected || undefined}
                >
                  {cell.getDate()}
                </button>
              );
            })}
          </div>
          <div className="dtp-time-row">
            <span className="muted">Time</span>
            <select
              aria-label="Hour"
              value={parsed ? parsed.getHours() : 9}
              onChange={(event) => handleHourChange(event.target.value)}
            >
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label="Minute"
              value={parsed ? parsed.getMinutes() : 0}
              onChange={(event) => handleMinuteChange(event.target.value)}
            >
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function parseLocal(value) {
  if (!value) return null;
  // value is "YYYY-MM-DDTHH:MM" interpreted as local time.
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocal(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatHuman(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Build a Sun-to-Sat 6-week grid for a month, padded with `null` cells.
// We use Mon-first to match WEEKDAYS above.
function buildMonthCells(monthStart) {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const first = new Date(year, month, 1);
  // 0 = Sunday in JS. We want Monday=0 column, so shift.
  const leadingBlanks = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
