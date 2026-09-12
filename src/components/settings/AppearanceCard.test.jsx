import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceCard } from './AppearanceCard';

// What matters here is not that the component renders — it is that picking
// an option actually reaches the two places the theme lives: the attributes
// on <html>, which are what tokens.css keys off, and localStorage, which is
// what the pre-paint script in index.html reads on the next load. A control
// that updated its own state and nothing else would look completely correct
// in a snapshot.

const html = () => document.documentElement;

describe('AppearanceCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    html().removeAttribute('data-theme');
    html().removeAttribute('data-accent');
  });

  afterEach(cleanup);

  test('starts on the stored choice, and paints it without being touched', () => {
    window.localStorage.setItem('posty.theme', 'dark');
    window.localStorage.setItem('posty.accent', 'iris');
    render(<AppearanceCard />);

    expect(screen.getByRole('button', { name: /dark/i })).toHaveClass('active');
    expect(screen.getByRole('radio', { name: /iris/i })).toBeChecked();
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-accent')).toBe('iris');
  });

  test('choosing a theme paints the document and persists it', () => {
    render(<AppearanceCard />);
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));

    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.theme')).toBe('dark');
  });

  test('System REMOVES the attribute, so the OS preference can win', () => {
    // The subtle one. Writing data-theme="system" would be silently inert:
    // tokens.css only matches 'light' and 'dark', so the page would be stuck
    // on whatever the previous choice painted. Following the OS means having
    // no attribute at all, letting the prefers-color-scheme block apply.
    window.localStorage.setItem('posty.theme', 'dark');
    render(<AppearanceCard />);
    // Applied on mount, so the control and the page always agree even if
    // the pre-paint script never ran.
    expect(html().getAttribute('data-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: /system/i }));
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('posty.theme')).toBe('system');
  });

  test('choosing an accent paints the document and persists it', () => {
    render(<AppearanceCard />);
    fireEvent.click(screen.getByRole('radio', { name: /verdigris/i }));

    expect(html().getAttribute('data-accent')).toBe('verdigris');
    expect(window.localStorage.getItem('posty.accent')).toBe('verdigris');
  });

  test('theme and accent are independent', () => {
    // They are stored under separate keys and written by one call, so it is
    // genuinely possible to clobber one while setting the other.
    render(<AppearanceCard />);
    fireEvent.click(screen.getByRole('radio', { name: /iris/i }));
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));

    expect(html().getAttribute('data-accent')).toBe('iris');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.accent')).toBe('iris');
  });

  test('the accent group is a radiogroup with exactly one selection', () => {
    render(<AppearanceCard />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.checked)).toHaveLength(1);

    fireEvent.click(screen.getByRole('radio', { name: /verdigris/i }));
    expect(screen.getAllByRole('radio').filter((r) => r.checked)).toHaveLength(1);
  });

  test('each swatch carries the preview attribute its colour comes from', () => {
    // The dot is painted by tokens.css via [data-accent-preview]. Lose the
    // attribute and every swatch silently shows the CURRENT accent, so all
    // three look identical and the picker stops communicating anything.
    render(<AppearanceCard />);
    ['harbour', 'verdigris', 'iris'].forEach((id) => {
      const swatch = document.querySelector(`[data-accent-preview="${id}"]`);
      expect(swatch).not.toBeNull();
      expect(swatch.querySelector('.accent-swatch-dot')).not.toBeNull();
    });
  });
});
