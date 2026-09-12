// Browser / OS / device from a user-agent string.
//
// Deliberately small and deliberately not a library. An audit log needs to
// answer "was that really them?", which takes a recognisable name — "Chrome
// on macOS" — not a version matrix. The raw string is stored, so a better
// parser can always do better later on the same rows.
//
// Order matters throughout: every Chromium browser also says "Chrome", and
// Chrome itself also says "Safari". The most specific claim has to be tested
// first or everything collapses into one answer.

const BROWSERS = [
  [/\bEdg[A-Z]?\/([\d.]+)/, 'Edge'],
  [/\bOPR\/([\d.]+)/, 'Opera'],
  [/\bSamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
  [/\bFirefox\/([\d.]+)/, 'Firefox'],
  [/\bChrome\/([\d.]+)/, 'Chrome'],
  [/\bVersion\/([\d.]+).*\bSafari\//, 'Safari'],
  [/\bSafari\/([\d.]+)/, 'Safari'],
];

const PLATFORMS = [
  [/\bWindows NT 10/, 'Windows'],
  [/\bWindows/, 'Windows'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

export function parseUserAgent(raw) {
  const ua = String(raw || '');
  if (!ua.trim()) return { browser: null, version: null, platform: null, device: null, label: null };

  // A request from our own server, a script or curl is worth saying plainly
  // rather than reporting as an unknown browser.
  if (/^(curl|wget|node|axios|python-requests|PostmanRuntime)/i.test(ua)) {
    const tool = ua.split('/')[0];
    return {
      browser: tool, version: null, platform: null, device: 'script', label: tool,
    };
  }

  let browser = null;
  let version = null;
  for (const [re, name] of BROWSERS) {
    const m = ua.match(re);
    if (m) { browser = name; [, version] = m; break; }
  }

  let platform = null;
  for (const [re, name] of PLATFORMS) {
    if (re.test(ua)) { platform = name; break; }
  }

  const device = /\b(iPhone|iPod|Android.*Mobile|Windows Phone)\b/.test(ua) ? 'mobile'
    : /\b(iPad|Tablet|Android)\b/.test(ua) ? 'tablet'
      : 'desktop';

  const major = version ? version.split('.')[0] : null;
  const label = browser
    ? `${browser}${major ? ` ${major}` : ''}${platform ? ` on ${platform}` : ''}`
    : null;

  return {
    browser, version, platform, device, label,
  };
}
