// Detect URLs whose host a remote mail client (Gmail's image proxy, Outlook,
// etc.) cannot fetch from outside the developer's machine. Used to warn before
// sending an email whose embedded images point at localhost or a private LAN.

const UNREACHABLE_HOST_PATTERNS = [
  /^localhost(:\d+)?$/i,
  /^127\./,                       // 127.0.0.0/8 loopback
  /^10\./,                        // 10.0.0.0/8 private
  /^192\.168\./,                  // 192.168.0.0/16 private
  /^172\.(1[6-9]|2\d|3[01])\./,   // 172.16.0.0/12 private
  /^\[?::1\]?$/,                  // IPv6 loopback
  /\.local$/i,                    // mDNS / Bonjour
];

export function isUnreachableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const { hostname } = new URL(url);
    return UNREACHABLE_HOST_PATTERNS.some((re) => re.test(hostname));
  } catch {
    // Relative or malformed URL. That's a different problem; not flagged here.
    return false;
  }
}

export function findUnreachableImageUrls(html, logoUrl) {
  const found = new Set();
  if (isUnreachableUrl(logoUrl)) found.add(logoUrl);
  const re = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html || ''))) {
    if (isUnreachableUrl(match[1])) found.add(match[1]);
  }
  return [...found];
}
