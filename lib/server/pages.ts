/**
 * PostgREST answers at most `max_rows` rows per request (supabase/config.toml
 * [api] max_rows), cutting the rest without an error. A page bigger than that
 * would come back short and end a paged read early, so pages never exceed it.
 */
export const MAX_ROWS_PAGE = 1000

type PageResult<T> = PromiseLike<{
  data: T[] | null
  error: { message?: string; code?: string } | null
}>

/**
 * Every row of a read that may pass `max_rows`, fetched one page at a time
 * until a short page. `page(from, to)` must apply a total order (end it with
 * a unique column), or rows can repeat or go missing across pages.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PageResult<T>
): Promise<
  | { ok: true; rows: T[] }
  | { ok: false; error: { message?: string; code?: string } }
> {
  const rows: T[] = []
  for (let from = 0; ; from += MAX_ROWS_PAGE) {
    const { data, error } = await page(from, from + MAX_ROWS_PAGE - 1)
    if (error) return { ok: false, error }
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < MAX_ROWS_PAGE) return { ok: true, rows }
  }
}
