// Tenant guard for upserts keyed on a caller-supplied id.
//
// Four tables took a row id straight from the request body and handed it to
// prisma.upsert({ where: { id } }). The comments above them all said some
// version of "the id either belongs to THIS account or it is brand-new,
// so a straight upsert is safe" — which is true of an id the server read
// back, and false of an id a client sent. The create branch stamped
// accountId; the update branch did not filter by it, so a caller in one
// workspace could name another workspace's audience, segment, campaign or
// draft id and overwrite its contents.
//
// The check is a read before the write. It costs one indexed lookup on a
// primary key, which is the cheapest query there is, and it is the only
// thing standing between two tenants on a shared install.
//
// It answers 404, not 403: telling someone their id belongs to a different
// workspace confirms the id exists, which is itself a small leak and no use
// to a legitimate caller, who cannot have got here honestly.
export async function assertOwnedOrNew(model, id, accountId) {
  if (!id) return;
  const existing = await model.findUnique({
    where: { id },
    select: { accountId: true },
  });
  if (existing && existing.accountId !== accountId) {
    const error = new Error('Not found');
    error.status = 404;
    throw error;
  }
}
