/** @param {unknown} payload */
export function parseUsageEventsPage(payload) {
  const body = /** @type {Record<string, unknown>} */ (payload ?? {});
  const pagination = /** @type {Record<string, unknown>} */ (body.pagination ?? {});
  const items = body.usageEvents ?? body.usage_events ?? body.events ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    hasNextPage: Boolean(pagination.hasNextPage ?? pagination.has_next_page ?? body.hasNextPage ?? body.has_next_page)
  };
}

/** @param {unknown} payload */
export function parseDailyUsagePage(payload) {
  const body = /** @type {Record<string, unknown>} */ (payload ?? {});
  const pagination = /** @type {Record<string, unknown>} */ (body.pagination ?? {});
  const items = body.data ?? body.rows ?? body.usage ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    hasNextPage: Boolean(pagination.hasNextPage ?? pagination.has_next_page ?? body.hasNextPage ?? body.has_next_page)
  };
}
