import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Loading, LoadingPage, Spinner } from './Spinner';

// The delay is the feature, so it is what gets tested. A spinner that appears
// instantly is worse than none on a fast request: it flashes on and off, which
// reads as a glitch. These assert it stays away for short waits and shows up
// for long ones.

describe('Spinner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

  test('shows nothing at all for a fast load', () => {
    // The whole reason for the delay: an 80ms request must never flash.
    render(<Loading />);
    advance(80);
    expect(document.querySelector('.spinner')).toBeNull();
    expect(document.body.textContent).not.toMatch(/loading/i);
  });

  test('appears once the wait is long enough to need explaining', () => {
    render(<Loading />);
    advance(250);
    expect(document.querySelector('.spinner')).not.toBeNull();
  });

  test('announces itself, and the ring is decorative', () => {
    render(<Loading />);
    advance(250);
    const status = document.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toMatch(/loading/i);
    // The ring conveys nothing a screen reader should read — the text does.
    expect(document.querySelector('.spinner').getAttribute('aria-hidden')).toBe('true');
  });

  test('a custom label is what gets announced', () => {
    render(<Loading label="Checking your session…" />);
    advance(250);
    expect(document.querySelector('[role="status"]').textContent)
      .toMatch(/checking your session/i);
  });

  test('the label can be hidden visually and still announced', () => {
    render(<Loading label="Fetching" showLabel={false} />);
    advance(250);
    const status = document.querySelector('[role="status"]');
    expect(status.textContent).toMatch(/fetching/i);
    expect(status.querySelector('.visually-hidden')).not.toBeNull();
  });

  test('the delay is configurable per call site', () => {
    render(<Loading delay={0} />);
    advance(1);
    expect(document.querySelector('.spinner')).not.toBeNull();
  });

  test('size drives the ring through a custom property, not a class', () => {
    render(<Spinner size={22} />);
    expect(document.querySelector('.spinner').style.getPropertyValue('--spinner-size'))
      .toBe('22px');
  });

  test('the route fallback behaves the same way', () => {
    render(<LoadingPage />);
    advance(80);
    expect(document.querySelector('.spinner')).toBeNull();
    advance(200);
    expect(document.querySelector('.loading-page')).not.toBeNull();
  });
});
