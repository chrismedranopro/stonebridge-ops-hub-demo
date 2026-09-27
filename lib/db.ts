// Typed handling for Supabase results. The rule this enforces: a failed query
// must surface as an error, never as an empty (and therefore "all clear") list.

interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

interface QueryResult<T> {
  data: T | null;
  error: PostgrestLikeError | null;
}

/** A database call that failed, labelled with what the app was trying to do. */
export class DbError extends Error {
  readonly source: string;
  readonly code?: string;

  constructor(source: string, error: PostgrestLikeError) {
    super(`${source}: ${error.message}`);
    this.name = "DbError";
    this.source = source;
    this.code = error.code;
  }
}

/** Return the data, or throw a DbError naming `source`. A null result becomes an empty array only for list queries. */
export function unwrap<T>(result: QueryResult<T>, source: string): T {
  if (result.error) throw new DbError(source, result.error);
  if (result.data === null) throw new DbError(source, { message: "No data returned" });
  return result.data;
}

export function unwrapList<T>(result: QueryResult<T[]>, source: string): T[] {
  if (result.error) throw new DbError(source, result.error);
  return result.data ?? [];
}

/**
 * For writes filtered by RLS: Postgres reports success when zero rows match,
 * so compare what actually changed with what was asked for.
 */
export function expectRowsChanged(result: QueryResult<unknown[]>, expected: number, source: string): void {
  if (result.error) throw new DbError(source, result.error);
  const changed = result.data?.length ?? 0;
  if (changed !== expected) {
    throw new DbError(source, {
      message: `expected to update ${expected} row(s) but updated ${changed}. It may have been changed by someone else, or you may not have access.`,
    });
  }
}

/** Collects per-source failures for pages that load several independent sections. */
export class PartialLoad {
  readonly failedSources: string[] = [];

  /** Rows from a list query, or [] after recording the failure. */
  rows<T>(result: QueryResult<T[]>, source: string): T[] {
    if (result.error) {
      console.error(new DbError(source, result.error));
      this.failedSources.push(source);
      return [];
    }
    return result.data ?? [];
  }

  get complete(): boolean {
    return this.failedSources.length === 0;
  }
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
