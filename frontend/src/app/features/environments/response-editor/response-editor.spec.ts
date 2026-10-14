import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResponseEditor } from './response-editor';
import { createRouteResponse } from '../../../core/defaults';
import { MockApiClient } from '../../../core/mock-api.client';
import { RouteResponse } from '../../../core/types';

class MockApiStub {
  previewTemplateCalls: { environmentUuid: string; template: string }[] = [];
  previewCalls = 0;

  async previewTemplate(environmentUuid: string, template: string) {
    this.previewCalls++;
    this.previewTemplateCalls.push({ environmentUuid, template });
    return { output: 'RENDERED[' + template + ']', warnings: ['helper not found: x'] };
  }
}

describe('ResponseEditor', () => {
  let apiStub: MockApiStub;

  function buildFixture(initialResponse: RouteResponse | null) {
    const emittedResponses: RouteResponse[] = [];
    const fixture: ComponentFixture<ResponseEditor> = TestBed.createComponent(ResponseEditor);
    fixture.componentRef.setInput('responseInput', initialResponse);
    fixture.componentRef.setInput('environmentUuidInput', 'env-1');
    // Controlled: echo emissions back into the input.
    fixture.componentInstance.responseChange.subscribe((nextResponse) => {
      emittedResponses.push(nextResponse);
      fixture.componentRef.setInput('responseInput', nextResponse);
    });
    fixture.detectChanges();
    return { fixture, emittedResponses };
  }

  beforeEach(() => {
    apiStub = new MockApiStub();
    TestBed.configureTestingModule({ providers: [{ provide: MockApiClient, useValue: apiStub }] });
  });

  it('emits a changed label and a clamped status code', () => {
    const sourceResponse = createRouteResponse('Old');
    const { fixture, emittedResponses } = buildFixture(sourceResponse);
    const labelInput = fixture.nativeElement.querySelector('.response-editor__label-input') as HTMLInputElement;
    labelInput.value = 'New';
    labelInput.dispatchEvent(new Event('change'));
    expect(emittedResponses.at(-1)?.label).toBe('New');

    const statusInput = fixture.nativeElement.querySelector('.response-editor__status-input') as HTMLInputElement;
    statusInput.value = '99';
    statusInput.dispatchEvent(new Event('change'));
    expect(emittedResponses.at(-1)?.statusCode).toBe(100);
    statusInput.value = '700';
    statusInput.dispatchEvent(new Event('change'));
    expect(emittedResponses.at(-1)?.statusCode).toBe(599);
  });

  it('clamps a negative latency to zero', () => {
    const sourceResponse = createRouteResponse();
    const { fixture, emittedResponses } = buildFixture(sourceResponse);
    const latencyInput = fixture.nativeElement.querySelector('.response-editor__latency-input') as HTMLInputElement;
    latencyInput.value = '-25';
    latencyInput.dispatchEvent(new Event('change'));
    expect(emittedResponses.at(-1)?.latency).toBe(0);
  });

  it('commits body text typed into the uncontrolled textarea', () => {
    const sourceResponse = createRouteResponse();
    sourceResponse.body = '';
    const { fixture, emittedResponses } = buildFixture(sourceResponse);
    const bodyTextarea = fixture.nativeElement.querySelector('.response-editor__body-textarea') as HTMLTextAreaElement;
    bodyTextarea.value = '{"ok": true}';
    bodyTextarea.dispatchEvent(new Event('input'));
    expect(emittedResponses.at(-1)?.body).toBe('{"ok": true}');
  });

  it('switching body type commits the live textarea text and swaps the UI', () => {
    const sourceResponse = createRouteResponse();
    sourceResponse.body = 'typed text';
    const { fixture, emittedResponses } = buildFixture(sourceResponse);
    const bodyTextarea = fixture.nativeElement.querySelector('.response-editor__body-textarea') as HTMLTextAreaElement;
    // Simulate a fresh keystroke without relying on the seed.
    bodyTextarea.value = 'typed text extra';
    bodyTextarea.dispatchEvent(new Event('input'));
    const bodyTypeSelect = fixture.nativeElement.querySelector('.response-editor__body-type') as HTMLSelectElement;
    bodyTypeSelect.value = 'FILE';
    bodyTypeSelect.dispatchEvent(new Event('change'));
    const emittedResponse = emittedResponses.at(-1);
    expect(emittedResponse?.bodyType).toBe('FILE');
    expect(emittedResponse?.body).toBe('typed text extra');
    fixture.detectChanges();
    // The INLINE textarea is gone; the FILE input is shown.
    expect(fixture.nativeElement.querySelector('.response-editor__body-textarea')).toBeNull();
    expect(fixture.nativeElement.querySelector('.response-editor__file-input')).not.toBeNull();
  });

  it('inserts a helper snippet at the caret and commits the result', () => {
    const sourceResponse = createRouteResponse();
    sourceResponse.body = '{"name": ""}';
    const { fixture, emittedResponses } = buildFixture(sourceResponse);
    const bodyTextarea = fixture.nativeElement.querySelector('.response-editor__body-textarea') as HTMLTextAreaElement;
    bodyTextarea.value = '{"name": ""}';
    // Index 10 sits between the two quotes of the empty string.
    bodyTextarea.selectionStart = 10;
    bodyTextarea.selectionEnd = 10;
    fixture.componentInstance.insertSnippetIntoBody('{{faker.person.fullName}}');
    expect(bodyTextarea.value).toBe('{"name": "{{faker.person.fullName}}"}');
    expect(emittedResponses.at(-1)?.body).toBe('{"name": "{{faker.person.fullName}}"}');
  });

  it('previews the live body through the preview-template endpoint', async () => {
    const sourceResponse = createRouteResponse();
    sourceResponse.body = '{"a": 1}';
    const { fixture } = buildFixture(sourceResponse);
    const previewButton = fixture.nativeElement.querySelector(
      '.response-editor__preview-btn',
    ) as HTMLButtonElement;
    previewButton.click();
    await fixture.whenStable();
    expect(apiStub.previewCalls).toBe(1);
    expect(apiStub.previewTemplateCalls[0]).toEqual({ environmentUuid: 'env-1', template: '{"a": 1}' });
    expect(fixture.nativeElement.querySelector('.response-editor__preview-output')?.textContent).toContain(
      'RENDERED[{"a": 1}]',
    );
    expect(fixture.nativeElement.querySelector('.response-editor__preview-warning')?.textContent).toContain(
      'helper not found: x',
    );
  });
});
