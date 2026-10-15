import { Pipe, PipeTransform } from '@angular/core';
import { elapsedSince } from '../../core/utils';

/**
 * F13 — relative-time label for the log viewer ("2 s ago", "120 ms").
 *
 * Impure on purpose: the log viewer re-renders on every 5 s poll, and the
 * label should track the `nowMs` the caller passes, not the cached value.
 */
@Pipe({ name: 'elapsedTime', pure: false })
export class ElapsedTimePipe implements PipeTransform {
  transform(logTimestampMs: number, nowMs: number = Date.now()): string {
    return elapsedSince(logTimestampMs, nowMs);
  }
}
