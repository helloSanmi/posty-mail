export const countryOptions = [
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

export function countryName(code) {
  const normalized = String(code || '').toUpperCase();
  const match = countryOptions.find(([value]) => value === normalized);
  return match?.[1] || code || '-';
}
