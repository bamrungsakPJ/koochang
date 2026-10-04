import { apiError } from './api-error.js';

export function pagination(limit: string | undefined, offset: string | undefined, defaultSize: number, maxSize: number) {
  const size = limit === undefined ? defaultSize : Number(limit);
  const start = offset === undefined ? 0 : Number(offset);
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(start) || start < 0 || start > 2147483647)
    throw apiError(400, 'VALIDATION_ERROR');
  return { limit: Math.min(size, maxSize), offset: start };
}
/** Fetch one extra row under the same tenant context to detect a next page. */
export function pageRows<T>(rows: T[], page: { limit: number; offset: number }) {
  const has_more = rows.length > page.limit;
  return { items: rows.slice(0, page.limit), ...page, has_more, next_offset: has_more ? page.offset + page.limit : null };
}
