import { prisma } from './db.js';

// Signing out your other devices, on a stateless token.
//
// There is no session table to delete rows from: a JWT is valid because it
// verifies, not because the server remembers it. So each token carries the
// `tokenVersion` its user had when it was minted, and requireAuth refuses any
// token whose version is behind the user's current one. Bumping the column
// invalidates every token in existence for that user, everywhere, at once.
//
// An integer rather than a "valid from" timestamp on purpose. `iat` has
// one-second resolution, so a timestamp comparison makes "is the token I
// issued a millisecond ago still valid?" depend on which side of a second
// boundary the bump and the signing happened to land — which is a coin flip
// that signs you out of the device you are sitting at.
//
// The cost is a lookup per request, so it is cached. The cache is per
// process; a second process (the Business B instance runs its own) picks up a
// bump within TTL_MS rather than instantly. That window is stated rather than
// hidden: a revocation that takes up to a minute to reach another process is
// worth knowing about, and closing it properly means shared state this app
// does not have.
const TTL_MS = 60_000;
const cache = new Map();

export function invalidateSessionCache(userId) {
  cache.delete(userId);
}

export function clearSessionCache() {
  cache.clear();
}

export async function currentTokenVersion(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.version;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  // A user that no longer exists gets `null`, which never equals a token's
  // numeric version — so a deleted account's tokens stop working rather than
  // falling through to a default.
  const version = user ? user.tokenVersion : null;
  cache.set(userId, { version, at: Date.now() });
  return version;
}

// Bump, and return the new version so the caller can mint a replacement
// token that survives its own revocation.
export async function revokeOtherSessions(userId) {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  invalidateSessionCache(userId);
  return updated.tokenVersion;
}
