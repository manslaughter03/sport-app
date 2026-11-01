/**
 * Reactivity: Dexie `liveQuery` → Preact state (docs/architecture.md §4).
 *
 * Logging a set re-runs the query and the screen updates with no manual refresh
 * and no state library. `liveQuery` emits immediately and again on any write to
 * the tables it touched.
 */

import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "preact/hooks";

export interface LiveState<T> {
  data: T | undefined;
  error: Error | undefined;
}

/**
 * Subscribes to a Dexie query for the lifetime of the component.
 *
 * `deps` must list everything the query closes over; when any of them changes
 * the subscription is rebuilt. The latest `query` is held in a ref so the
 * subscription always calls the current closure without making `query` itself a
 * dependency (which would resubscribe on every render).
 *
 * Errors are caught *inside* the observable rather than left to reject. A query
 * can fail because the database closed underneath it (component unmounting, a
 * schema upgrade, Android evicting storage); an unhandled rejection there is
 * noise at best and, in a test runner that treats them as failures, a red build
 * with every assertion passing.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  deps: readonly unknown[],
  initial: T | undefined = undefined,
): LiveState<T> {
  const [state, setState] = useState<LiveState<T>>({ data: initial, error: undefined });
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    let cancelled = false;

    const subscription = liveQuery(async () => {
      try {
        return { ok: true as const, value: await queryRef.current() };
      } catch (error) {
        return { ok: false as const, error: toError(error) };
      }
    }).subscribe({
      next: (result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { data: result.value, error: undefined }
            : { data: undefined, error: result.error },
        );
      },
      error: (error: unknown) => {
        if (cancelled) return;
        setState({ data: undefined, error: toError(error) });
      },
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // Generic hook: `deps` is the caller's list, which this rule cannot inspect
    // statically. Callers are responsible for listing what `query` closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
