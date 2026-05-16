// Region picker data.
//
// Deliberately short list: three countries Posty is actively used in (UK,
// US, Nigeria) plus five continent buckets to cover everywhere else. A
// full ISO 3166-1 list of 250 entries was rejected as overkill for the
// volumes we email — most admins know the country of their audience
// without needing a deep dropdown. If you genuinely need finer-grained
// region targeting later, swap this for the ISO list + a searchable
// picker component.
//
// Country codes are ISO 3166-1 alpha-2. Continent codes use UPPERCASE
// readable names ("AFRICA" etc.) to make them obviously NOT ISO country
// codes and to sidestep collisions with real country codes (e.g. AF would
// clash with Afghanistan, NA with Namibia).
const PRIORITY_CODES = ['GB', 'US', 'NG'];

const ALL_REGIONS = [
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['NG', 'Nigeria'],
  ['AFRICA', 'Africa'],
  ['AMERICAS', 'Americas'],
  ['ASIA', 'Asia'],
  ['EUROPE', 'Europe'],
  ['OCEANIA', 'Oceania'],
];

// Priority list in the explicit order PRIORITY_CODES defines (UK, US, NG).
export const priorityCountryOptions = PRIORITY_CODES
  .map((code) => ALL_REGIONS.find(([value]) => value === code))
  .filter(Boolean);

// Continent buckets, sorted alphabetically by label.
export const otherCountryOptions = ALL_REGIONS
  .filter(([value]) => !PRIORITY_CODES.includes(value))
  .sort((a, b) => a[1].localeCompare(b[1]));

// Flat list, priority first, continents second. Kept for any caller that
// needs a single array (lookups, validation, etc).
export const countryOptions = [...priorityCountryOptions, ...otherCountryOptions];

export function countryName(code) {
  const normalized = String(code || '').toUpperCase();
  const match = countryOptions.find(([value]) => value === normalized);
  return match?.[1] || code || '-';
}
