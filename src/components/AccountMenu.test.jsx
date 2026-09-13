import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen,
} from '@testing-library/react';
import { AccountMenu, initialsOf } from './AccountMenu';

// The account control moved from the bottom of the nav rail to the top right,
// and became a menu instead of a bare sign-out button.
//
// The thing worth testing is not that it renders — it is that signing out
// still works after being moved behind two clicks, and that the menu is
// dismissible by every route people actually use. A popover you can open but
// not close without reloading is worse than the button it replaced.

const EDITOR = {
  email: 'sanmi@example.com',
  name: 'Sanmi Idowu',
  role: 'editor',
  permissions: {
    v: 2,
    areas: { contacts: 'write', campaigns: 'manage', analytics: 'read' },
  },
};

const onSignOut = vi.fn();
const onOpenProfile = vi.fn();
const mount = (user = EDITOR) => render(
  <AccountMenu user={user} onSignOut={onSignOut} onOpenProfile={onOpenProfile} />,
);

const openMenu = (user) => {
  mount(user);
  fireEvent.click(screen.getByRole('button', { name: /^Account:/ }));
};

afterEach(() => { cleanup(); onSignOut.mockClear(); onOpenProfile.mockClear(); });

describe('the trigger', () => {
  test('has a real accessible name, not two letters', () => {
    // The visible content is initials, which say nothing aloud.
    mount();
    expect(screen.getByRole('button', { name: 'Account: Sanmi Idowu' })).toBeInTheDocument();
  });

  test('renders nothing at all when signed out', () => {
    const { container } = render(
      <AccountMenu user={null} onSignOut={onSignOut} onOpenProfile={onOpenProfile} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('initials fall back sensibly', () => {
    expect(initialsOf({ name: 'Sanmi Idowu' })).toBe('SI');
    expect(initialsOf({ email: 'sanmi.idowu@example.com' })).toBe('SI');
    expect(initialsOf({ email: 'ops@example.com' })).toBe('O');
    expect(initialsOf({})).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });
});

describe('the menu', () => {
  test('is closed until asked for', () => {
    mount();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('shows who you are signed in as', () => {
    openMenu();
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Sanmi Idowu');
    expect(menu).toHaveTextContent('sanmi@example.com');
    expect(menu).toHaveTextContent('editor');
  });

  test('does not print the email twice when it IS the name', () => {
    openMenu({ ...EDITOR, name: '' });
    const menu = screen.getByRole('menu');
    expect(menu.querySelectorAll('.sh-account-email')).toHaveLength(0);
    expect(menu).toHaveTextContent('sanmi@example.com');
  });

  test('signs out — the one thing it must not have lost in the move', () => {
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test('closes on Escape, and gives focus back to the trigger', () => {
    // Without the refocus, focus lands on <body> and the next Tab restarts
    // from the top of the page.
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Account:/ }));
  });

  test('closes on a press outside', () => {
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('a second click on the trigger closes it again', () => {
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Account:/ }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the profile item', () => {
  test('asks to open the profile, and closes the menu behind it', () => {
    // The profile is a PAGE now, so this component's whole job here is the
    // handoff — it deliberately does not know the route, which keeps it
    // renderable in a test with no router. The page is covered in
    // src/pages/ProfilePage.test.jsx.
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Your profile/ }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
