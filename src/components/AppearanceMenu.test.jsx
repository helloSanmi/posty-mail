import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceMenu } from './AppearanceMenu';

// What matters is not that it renders — it is that a choice reaches the two
// places the theme actually lives: the attributes on <html>, which are what
// tokens.css keys off, and localStorage, which the pre-paint script in
// index.html reads on the next load. A control that updated its own state
// and nothing else would look perfectly correct in a snapshot.

const html = () => document.documentElement;
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /appearance/i }));

describe('AppearanceMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    html().removeAttribute('data-theme');
    html().removeAttribute('data-accent');
  });

  afterEach(cleanup);

  test('applies the stored choice on mount, before being opened', () => {
    window.localStorage.setItem('posty.theme', 'dark');
    window.localStorage.setItem('posty.accent', 'iris');
    render(<AppearanceMenu />);

    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-accent')).toBe('iris');
  });

  test('the panel is closed until asked for', () => {
    render(<AppearanceMenu />);
    expect(screen.queryByRole('dialog')).toBeNull();
    openMenu();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('Escape closes it', () => {
    render(<AppearanceMenu />);
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a press outside closes it', () => {
    render(<AppearanceMenu />);
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('choosing a theme paints the document and persists it', () => {
    render(<AppearanceMenu />);
    openMenu();
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
    render(<AppearanceMenu />);
    expect(html().getAttribute('data-theme')).toBe('dark');

    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: /system/i }));
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem('posty.theme')).toBe('system');
  });

  test('choosing an accent paints the document and persists it', () => {
    render(<AppearanceMenu />);
    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: /verdigris/i }));

    expect(html().getAttribute('data-accent')).toBe('verdigris');
    expect(window.localStorage.getItem('posty.accent')).toBe('verdigris');
  });

  test('theme and accent are independent', () => {
    // Separate storage keys written by one call, so it is genuinely possible
    // to clobber one while setting the other.
    render(<AppearanceMenu />);
    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: /iris/i }));
    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));

    expect(html().getAttribute('data-accent')).toBe('iris');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('posty.accent')).toBe('iris');
  });

  test('two radiogroups, each with exactly one selection', () => {
    render(<AppearanceMenu />);
    openMenu();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    expect(radios.filter((r) => r.checked)).toHaveLength(2);
  });

  test('each swatch carries the preview attribute its colour comes from', () => {
    // The dot is painted by tokens.css via [data-accent-preview]. Lose the
    // attribute and every swatch silently shows the CURRENT accent, so all
    // three look identical and the picker stops communicating anything.
    render(<AppearanceMenu />);
    openMenu();
    ['harbour', 'verdigris', 'iris'].forEach((id) => {
      const swatch = document.querySelector(`[data-accent-preview="${id}"]`);
      expect(swatch).not.toBeNull();
      expect(swatch.querySelector('.ap-dot')).not.toBeNull();
    });
  });

  test('the trigger reports the current mode to assistive tech', () => {
    window.localStorage.setItem('posty.theme', 'dark');
    render(<AppearanceMenu />);
    const trigger = screen.getByRole('button', { name: /appearance/i });
    expect(trigger.getAttribute('aria-label')).toMatch(/dark/i);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
