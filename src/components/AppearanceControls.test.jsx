import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceControls } from './AppearanceControls';
import { ACCENTS } from '../theme';

// All six controls are on the surface — there is no panel to open — so each
// test acts on them directly.
//
// What matters is not that it renders — it is that a choice reaches the two
// places the theme actually lives: the attributes on <html>, which are what
// tokens.css keys off, and localStorage, which the pre-paint script in
// index.html reads on the next load. A control that updated its own state
// and nothing else would look perfectly correct in a snapshot.

const html = () => document.documentElement;

describe('AppearanceControls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    html().removeAttribute('data-theme');
    html().removeAttribute('data-accent');
  });

  afterEach(cleanup);

  test('applies the stored choice on mount, with no interaction at all', () => {
    window.localStorage.setItem('posty.theme', 'dark');
    window.localStorage.setItem('posty.accent', 'iris');
    render(<AppearanceControls />);

    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-accent')).toBe('iris');
  });




  test('choosing a theme paints the document and persists it', () => {
    render(<AppearanceControls />);
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));

    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.theme')).toBe('dark');
  });

  test('System REMOVES the attribute, so the OS preference can win', () => {
    // The subtle one. Writing data-theme="system" would be silently inert:
    // tokens.css only matches 'light' and 'dark', so the page would stay on
    // whatever the previous choice painted. Following the OS means having no
    // attribute at all, letting the prefers-color-scheme block apply.
    window.localStorage.setItem('posty.theme', 'dark');
    render(<AppearanceControls />);
    expect(html().getAttribute('data-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: /system/i }));
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('posty.theme')).toBe('system');
  });

  test('choosing an accent paints the document and persists it', () => {
    render(<AppearanceControls />);
    fireEvent.click(screen.getByRole('radio', { name: /verdigris/i }));

    expect(html().getAttribute('data-accent')).toBe('verdigris');
    expect(window.localStorage.getItem('posty.accent')).toBe('verdigris');
  });

  test('theme and accent are independent', () => {
    // Separate storage keys written by one call, so it is genuinely possible
    // to clobber one while setting the other.
    render(<AppearanceControls />);
    fireEvent.click(screen.getByRole('radio', { name: /iris/i }));
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));

    expect(html().getAttribute('data-accent')).toBe('iris');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.accent')).toBe('iris');
  });

  test('two radiogroups, each with exactly one selection', () => {
    render(<AppearanceControls />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    // three grounds + every accent, one chosen in each group
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3 + ACCENTS.length);
    expect(radios.filter((r) => r.checked)).toHaveLength(2);
  });

  test('exactly one accent reads as chosen', () => {
    // Three filled dots read as three indicators. One filled among two
    // outlines reads as a choice — which is the complaint that prompted it:
    // "the colour dot at the top right, don't know what's doing at all".
    render(<AppearanceControls />);
    const active = document.querySelectorAll('.ap-swatch.is-active');
    expect(active).toHaveLength(1);
    expect(document.querySelectorAll('.ap-swatch')).toHaveLength(ACCENTS.length);
  });

  test('each swatch carries the preview attribute its colour comes from', () => {
    // The dot is painted by tokens.css via [data-accent-preview]. Lose the
    // attribute and every swatch silently shows the CURRENT accent, so all
    // three look identical and the picker stops communicating anything.
    render(<AppearanceControls />);
    ACCENTS.map((a) => a.id).forEach((id) => {
      const swatch = document.querySelector(`[data-accent-preview="${id}"]`);
      expect(swatch).not.toBeNull();
      expect(swatch.querySelector('.ap-dot')).not.toBeNull();
    });
  });

});
