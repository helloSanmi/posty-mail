import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import { RolesManager } from './RolesManager';

// The access matrix and the role editor, mounted for real.
//
// What matters here is not that the grid renders — it is that the grid shows
// the access a role ACTUALLY has, which is not the same as the boxes someone
// ticked. A role granted Campaigns can read Audience and Email whether or not
// anyone asked for that, because the campaign builder resolves groups to
// recipients and lists templates. That was true before this change too; it
// was invisible, expressed as "reads are open to everyone" in a comment in
// the middle of the server. If the screen does not say so, the admin is
// granting access they cannot see, which is the failure this whole model
// exists to fix.
//
// So: a matrix that renders ticks would pass a snapshot test and still be
// wrong. These assert the words in the cells.

const ROLES = [
  {
    id: 'r1',
    key: 'admin',
    name: 'Admin',
    permissions: { v: 2, areas: {} },
    isSystem: true,
    locked: true,
    userCount: 2,
  },
  {
    id: 'r2',
    key: 'editor',
    name: 'Editor',
    permissions: { v: 2, areas: { campaigns: 'manage', templates: 'write' } },
    isSystem: true,
    locked: false,
    userCount: 5,
  },
  {
    id: 'r3',
    key: 'viewer',
    name: 'Viewer',
    permissions: { v: 2, areas: { analytics: 'read' } },
    isSystem: true,
    locked: false,
    userCount: 11,
  },
  {
    // The row shape that exists in every install predating this release.
    // It must render, and at the access it actually has.
    id: 'r4',
    key: 'legacy',
    name: 'Legacy',
    permissions: ['contacts'],
    isSystem: false,
    locked: false,
    userCount: 1,
  },
];

const updateRole = vi.fn(() => Promise.resolve({}));
const createRole = vi.fn(() => Promise.resolve({}));

vi.mock('../services/brevoApi', () => ({
  listRoles: () => Promise.resolve(ROLES),
  createRole: (...args) => createRole(...args),
  updateRole: (...args) => updateRole(...args),
  deleteRole: () => Promise.resolve({}),
}));

const mount = (props = {}) => render(<RolesManager {...props} />);

// The cell at (role, area), by reading the header row for the column index
// rather than counting — a positional index breaks the moment an area is
// added to the catalog, and breaks silently, asserting the wrong column.
function cell(roleName, areaLabel) {
  const header = screen.getByRole('columnheader', { name: areaLabel });
  const headerRow = header.closest('tr');
  const index = [...headerRow.children].indexOf(header);
  const row = screen.getByRole('row', { name: new RegExp(`^${roleName}\\b`) });
  return row.children[index];
}

describe('the access matrix', () => {
  afterEach(cleanup);

  test('renders a level per cell, not a tick', async () => {
    mount();
    await screen.findByText('Editor');
    expect(cell('Editor', 'Campaigns')).toHaveTextContent('Full');
    expect(cell('Editor', 'Email')).toHaveTextContent('Edit');
    expect(cell('Viewer', 'Reports')).toHaveTextContent('View');
  });

  test('an area with nothing granted reads as a dash', async () => {
    mount();
    await screen.findByText('Viewer');
    // A plain hyphen, matching the "no value" cells in the activity log.
    expect(cell('Viewer', 'Connections')).toHaveTextContent('-');
  });

  test('shows implied access, and says where it comes from', async () => {
    // The point of the whole exercise. Nobody ticked Audience for Editor.
    mount();
    await screen.findByText('Editor');
    const audience = cell('Editor', 'Audience');
    expect(audience).toHaveTextContent('View');
    expect(audience).toHaveTextContent('via Campaigns');
    expect(audience.querySelector('.roles-level')).toHaveClass('is-implied');
  });

  test('implied is visually distinct from granted at the same level', async () => {
    // Both say "View". If they looked identical, the matrix would be lying
    // about which ones an admin chose.
    mount();
    await screen.findByText('Viewer');
    expect(cell('Viewer', 'Reports').querySelector('.roles-level'))
      .not.toHaveClass('is-implied');
    expect(cell('Editor', 'Audience').querySelector('.roles-level'))
      .toHaveClass('is-implied');
  });

  test('the locked Admin row shows every area at its top rung', async () => {
    mount();
    await screen.findByText('Admin');
    // Admin's stored permissions are deliberately empty in the fixture: the
    // row must not depend on them. The server resolves admin separately, and
    // a matrix that read the row would show an admin with no access at all.
    expect(cell('Admin', 'Campaigns')).toHaveTextContent('Full');
    expect(cell('Admin', 'Connections')).toHaveTextContent('Edit');
    expect(cell('Admin', 'Reports')).toHaveTextContent('View');
  });

  test('a v1 array row still renders, at the top rung it used to mean', async () => {
    mount();
    await screen.findByText('Legacy');
    expect(cell('Legacy', 'Audience')).toHaveTextContent('Full');
  });

  test('every cell is readable without colour', async () => {
    // Four levels told apart by hue alone would fail for anyone who cannot
    // separate them — and for anyone asking "is that Edit or Full?".
    mount();
    await screen.findByText('Editor');
    document.querySelectorAll('.roles-level').forEach((el) => {
      expect(el.textContent.trim().length).toBeGreaterThan(0);
    });
  });
});

describe('the role editor', () => {
  afterEach(() => { cleanup(); updateRole.mockClear(); createRole.mockClear(); });

  async function openEditor(roleName) {
    mount();
    await screen.findByText(roleName);
    fireEvent.click(screen.getByRole('button', { name: `Edit ${roleName}` }));
    return screen.findByRole('dialog');
  }

  test('offers only the levels an area actually has', async () => {
    const dialog = await openEditor('Viewer');
    // Reports is read-only; a "write" rung on it would store a level nothing
    // checks, which reads as a grant to whoever looks at the row next.
    const reports = within(dialog).getByRole('radiogroup', { name: 'Reports' });
    expect(within(reports).getAllByRole('radio')).toHaveLength(2);
    const campaigns = within(dialog).getByRole('radiogroup', { name: 'Campaigns' });
    expect(within(campaigns).getAllByRole('radio')).toHaveLength(4);
  });

  test('opens with the role\'s current levels selected', async () => {
    const dialog = await openEditor('Editor');
    const campaigns = within(dialog).getByRole('radiogroup', { name: 'Campaigns' });
    expect(within(campaigns).getByRole('radio', { name: 'Full' }).checked).toBe(true);
  });

  test('implied access updates in the same gesture that causes it', async () => {
    // Ticking Campaigns has to light up Audience while the pointer is still
    // there. An admin who finds out afterwards has already saved.
    const dialog = await openEditor('Viewer');
    const audience = within(dialog).getByRole('radiogroup', { name: 'Audience' });
    expect(audience.closest('fieldset')).not.toHaveTextContent('because this role has');

    const campaigns = within(dialog).getByRole('radiogroup', { name: 'Campaigns' });
    fireEvent.click(within(campaigns).getByRole('radio', { name: 'Edit' }));

    expect(
      within(dialog).getByRole('radiogroup', { name: 'Audience' }).closest('fieldset'),
    ).toHaveTextContent('because this role has Campaigns');
  });

  test('saves a levelled map, not a list of area names', async () => {
    const dialog = await openEditor('Viewer');
    const campaigns = within(dialog).getByRole('radiogroup', { name: 'Campaigns' });
    fireEvent.click(within(campaigns).getByRole('radio', { name: 'Full' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(updateRole).toHaveBeenCalled());
    const [, payload] = updateRole.mock.calls[0];
    expect(payload.permissions.areas).toMatchObject({
      analytics: 'read',
      campaigns: 'manage',
    });
  });

  test('choosing None removes the area rather than storing "none"', async () => {
    const dialog = await openEditor('Editor');
    const templates = within(dialog).getByRole('radiogroup', { name: 'Email' });
    fireEvent.click(within(templates).getByRole('radio', { name: 'None' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(updateRole).toHaveBeenCalled());
    const [, payload] = updateRole.mock.calls[0];
    expect(payload.permissions.areas).not.toHaveProperty('templates');
  });

  test('there is no way to grant user and role management', async () => {
    // The privilege-escalation lock, at the layer the admin sees. The server
    // strips it twice more regardless.
    const dialog = await openEditor('Viewer');
    expect(within(dialog).queryByRole('radiogroup', { name: /access|admin|role/i })).toBeNull();
    expect(dialog).toHaveTextContent('cannot be granted here');
  });

  test('the Admin role cannot be opened for editing at all', async () => {
    mount();
    await screen.findByText('Admin');
    expect(screen.getByRole('button', { name: 'Edit Admin' })).toBeDisabled();
  });
});
