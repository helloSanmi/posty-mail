import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceControls } from './AppearanceControls';

// This control used to carry an accent picker too. It is gone: a palette
// chooser asks the reader to decide something the product should decide, and
// those six swatches changed nothing that mattered. What is left is
// light / dark / system, which is not a matter of taste — it is about the
// room someone is sitting in.
//
// What matters is that a choice reaches the two places the theme lives: the
// attribute on <html>, which is what tokens.css keys off, and localStorage,
// which the pre-paint script in index.html reads on the next load. A control
// that updated its own state and nothing else would look perfectly correct
// in a snapshot.

const html = () => document.documentElement;

describe('AppearanceControls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    html().removeAttribute('data-theme');
  });

  afterEach(cleanup);

  test('applies the stored choice on mount, with no interaction at all', () => {
    window.localStorage.setItem('posty.theme', 'dark');
    render(<AppearanceControls />);
    expect(html().getAttribute('data-theme')).toBe('dark');
  });

  test('choosing a theme paints the document and persists it', () => {
    render(<AppearanceControls />);
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));

    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.theme')).toBe('dark');
  });

  test('System REMOVES the attribute, so the OS preference can win', () => {
    // The subtle one. Writing data-theme="system" would be silently inert:
    // tokens.css matches only 'light' and 'dark', so the page would stay on
    // whatever the previous choice painted. Following the OS means having no
    // attribute at all, letting the prefers-color-scheme block apply.
    window.localStorage.setItem('posty.theme', 'dark');
    render(<AppearanceControls />);
    expect(html().getAttribute('data-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: /system/i }));
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('posty.theme')).toBe('system');
  });

  test('one radiogroup, three grounds, exactly one chosen', () => {
    render(<AppearanceControls />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(1);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
  });

  test('no accent picker remains', () => {
    // The point of the change, asserted so it cannot creep back.
    render(<AppearanceControls />);
    expect(document.querySelectorAll('.ap-swatch')).toHaveLength(0);
    expect(document.querySelector('[data-accent-preview]')).toBeNull();
  });
});
