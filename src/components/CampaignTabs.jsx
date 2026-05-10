import { NavLink } from 'react-router-dom';

export function CampaignTabs({ active }) {
  return (
    <nav className="page-tabs" aria-label="Campaigns sections">
      <NavLink
        to="/campaigns"
        end
        className={({ isActive }) => (isActive || active === 'all' ? 'page-tab active' : 'page-tab')}
      >
        All campaigns
      </NavLink>
      <NavLink
        to="/builder"
        className={({ isActive }) => (isActive || active === 'new' ? 'page-tab active' : 'page-tab')}
      >
        New campaign
      </NavLink>
    </nav>
  );
}
