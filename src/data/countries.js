// Country/region picker data.
//
// Three "priority" regions are pinned to the top of every dropdown because
// they're the bulk of who we email today. Everything else is grouped under
// "Other regions" and sorted alphabetically by label so users can scan it
// naturally. New additions to the long-tail list don't need a new commit
// here — they sort themselves into the right place at render time.
//
// Codes follow ISO 3166-1 alpha-2 (with "EU" as a regional aggregate).
const PRIORITY_CODES = ['GB', 'US', 'NG'];

const ALL_COUNTRIES = [
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['NG', 'Nigeria'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['IE', 'Ireland'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['NL', 'Netherlands'],
  ['ES', 'Spain'],
  ['IT', 'Italy'],
  ['SE', 'Sweden'],
  ['DK', 'Denmark'],
  ['NO', 'Norway'],
  ['FI', 'Finland'],
  ['ZA', 'South Africa'],
  ['GH', 'Ghana'],
  ['KE', 'Kenya'],
  ['IN', 'India'],
  ['AE', 'United Arab Emirates'],
  ['SG', 'Singapore'],
  ['BR', 'Brazil'],
  ['MX', 'Mexico'],
  ['EU', 'European Union'],
];

// Priority list in the explicit order PRIORITY_CODES defines (GB, US, NG).
export const priorityCountryOptions = PRIORITY_CODES
  .map((code) => ALL_COUNTRIES.find(([value]) => value === code))
  .filter(Boolean);

// Long-tail list, sorted alphabetically by label.
export const otherCountryOptions = ALL_COUNTRIES
  .filter(([value]) => !PRIORITY_CODES.includes(value))
  .sort((a, b) => a[1].localeCompare(b[1]));

// Flat list, priority first, "other" second. Kept for any caller that
// needs a single array (lookups, validation, etc).
export const countryOptions = [...priorityCountryOptions, ...otherCountryOptions];

export function countryName(code) {
  const normalized = String(code || '').toUpperCase();
  const match = countryOptions.find(([value]) => value === normalized);
  return match?.[1] || code || '-';
}
