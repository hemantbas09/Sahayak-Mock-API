import { Component, input, output } from '@angular/core';
import { RouteResponse } from '../../../core/types';
import { createRouteResponse } from '../../../core/defaults';
import { newUuid } from '../../../core/utils';

/**
 * F10 — response list (per route). Block: .response-list
 *
 * Controlled: renders `responsesInput` in walk order and emits the next
 * full array on structural mutation; field edits come back via
 * `responseChange` with the mutated clone.
 */
@Component({
  selector: 'app-response-list',
  template: `
    <div class="response-list">
      <header class="response-list__head">
        <h4 class="response-list__heading">Responses</h4>
        <button class="response-list__add" type="button" (click)="addResponse()">+ Add response</button>
      </header>

      @for (responseRow of responsesInput(); track responseRow.uuid; let responseIndex = $index) {
        <div
          class="response-list__row"
          [class.response-list__row--selected]="selectedUuidInput() === responseRow.uuid"
          (click)="selectChange.emit(responseRow.uuid)"
        >
          <label
            class="response-list__default"
            [title]="'mark as the default response'"
            (click)="$event.stopPropagation()"
          >
            <input
              type="radio"
              name="default-response"
              [checked]="responseRow.defaultResponse"
              (change)="setDefaultResponse(responseRow)"
            />
            <span>default</span>
          </label>

          <span
            class="response-list__status"
            [class.response-list__status--error]="responseRow.statusCode >= 400"
            [class.response-list__status--warn]="responseRow.statusCode >= 300 && responseRow.statusCode < 400"
          >
            {{ responseRow.statusCode }}
          </span>

          <span class="response-list__label">{{ responseRow.label || '(unlabelled)' }}</span>

          @if (responseRow.rules.length > 0) {
            <span class="response-list__rules-badge">{{ responseRow.rules.length }} rules</span>
          }

          <span class="response-list__row-actions" (click)="$event.stopPropagation()">
            <button
              type="button"
              title="Move up"
              [disabled]="responseIndex === 0"
              (click)="moveResponse(responseIndex, -1)"
            >↑</button>
            <button
              type="button"
              title="Move down"
              [disabled]="responseIndex === responsesInput().length - 1"
              (click)="moveResponse(responseIndex, 1)"
            >↓</button>
            <button type="button" title="Duplicate response" (click)="duplicateResponse(responseRow)">⧉</button>
            <button
              type="button"
              title="Delete response"
              class="response-list__delete"
              (click)="deleteResponse(responseRow)"
            >🗑</button>
          </span>
        </div>
      } @empty {
        <p class="response-list__empty">No responses — add one (the first becomes the default).</p>
      }
    </div>
  `,
  styleUrl: './response-list.scss',
})
export class ResponseList {
  readonly responsesInput = input<RouteResponse[]>([]);
  readonly responsesChange = output<RouteResponse[]>();
  /** Response whose editor should be focused (row click). */
  readonly selectChange = output<string>();
  /** Highlighted row (the one open in the editor). */
  readonly selectedUuidInput = input<string | null>(null);

  addResponse(): void {
    const sourceResponses = this.responsesInput();
    const hasDefault = sourceResponses.some((sourceResponse) => sourceResponse.defaultResponse);
    const newResponse = createRouteResponse('Response ' + (sourceResponses.length + 1));
    newResponse.defaultResponse = !hasDefault;
    this.emitResponses([...sourceResponses, newResponse]);
  }

  duplicateResponse(sourceResponse: RouteResponse): void {
    const cloneResponse = structuredClone(sourceResponse);
    cloneResponse.uuid = newUuid();
    cloneResponse.label = sourceResponse.label + ' (copy)';
    cloneResponse.defaultResponse = false;
    const insertIndex = this.responsesInput().findIndex(
      (responseRow) => responseRow.uuid === sourceResponse.uuid,
    );
    const nextResponses = [...this.responsesInput()];
    nextResponses.splice(insertIndex + 1, 0, cloneResponse);
    this.emitResponses(nextResponses);
  }

  deleteResponse(responseRow: RouteResponse): void {
    if (responseRow.defaultResponse) {
      window.confirm(
        'This is the default response. Deleting it leaves the route without a fallback — continue?',
      );
    }
    const sourceResponses = this.responsesInput();
    let nextResponses = sourceResponses.filter((otherResponse) => otherResponse.uuid !== responseRow.uuid);
    // Keep exactly one default when the deleted row carried it.
    if (responseRow.defaultResponse && nextResponses.length > 0 && !nextResponses.some((otherResponse) => otherResponse.defaultResponse)) {
      nextResponses = nextResponses.map((otherResponse, otherIndex) =>
        otherIndex === 0 ? { ...otherResponse, defaultResponse: true } : otherResponse,
      );
    }
    this.emitResponses(nextResponses);
  }

  moveResponse(fromIndex: number, direction: -1 | 1): void {
    const toIndex = fromIndex + direction;
    const sourceResponses = this.responsesInput();
    if (toIndex < 0 || toIndex >= sourceResponses.length) return;
    const nextResponses = [...sourceResponses];
    const [movedResponse] = nextResponses.splice(fromIndex, 1);
    nextResponses.splice(toIndex, 0, movedResponse);
    this.emitResponses(nextResponses);
  }

  setDefaultResponse(targetResponse: RouteResponse): void {
    this.emitResponses(
      this.responsesInput().map((responseRow) => ({
        ...responseRow,
        defaultResponse: responseRow.uuid === targetResponse.uuid,
      })),
    );
  }

  private emitResponses(nextResponses: RouteResponse[]): void {
    this.responsesChange.emit(nextResponses);
  }
}
