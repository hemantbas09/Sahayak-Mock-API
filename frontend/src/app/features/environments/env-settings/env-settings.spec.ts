import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvSettings } from './env-settings';
import { createEnvironment } from '../../../core/defaults';
import { Environment } from '../../../core/types';

describe('EnvSettings', () => {
  function buildFixture(initialEnvironment: Environment) {
    const emittedEnvironments: Environment[] = [];
    const emittedCloses = { count: 0 };
    const fixture: ComponentFixture<EnvSettings> = TestBed.createComponent(EnvSettings);
    fixture.componentRef.setInput('environmentInput', initialEnvironment);
    // Controlled: echo emissions back into the input.
    fixture.componentInstance.environmentChange.subscribe((nextEnvironment) => {
      emittedEnvironments.push(nextEnvironment);
      fixture.componentRef.setInput('environmentInput', nextEnvironment);
    });
    fixture.componentInstance.closed.subscribe(() => emittedCloses.count++);
    fixture.detectChanges();
    return { fixture, emittedEnvironments, emittedCloses };
  }

  function fieldInput(fixture: ComponentFixture<EnvSettings>, labelText: string): HTMLInputElement {
    const labels = fieldLabels(fixture, labelText);
    const targetInput = labels[0]?.querySelector('input');
    expect(targetInput).not.toBeNull();
    return targetInput as HTMLInputElement;
  }

  function checkInput(fixture: ComponentFixture<EnvSettings>, phrase: string): HTMLInputElement {
    const labels = checkLabels(fixture, phrase);
    const targetInput = labels[0]?.querySelector('input');
    expect(targetInput).not.toBeNull();
    return targetInput as HTMLInputElement;
  }

  function findFieldInput(fixture: ComponentFixture<EnvSettings>, labelText: string): HTMLInputElement | null {
    const labels = fieldLabels(fixture, labelText);
    return labels[0]?.querySelector('input') ?? null;
  }

  function fieldLabels(fixture: ComponentFixture<EnvSettings>, labelText: string): Element[] {
    const labelElements = fixture.nativeElement.querySelectorAll('.env-settings__field');
    const matches: Element[] = [];
    labelElements.forEach((labelElement: Element) => {
      if (labelElement.textContent?.includes(labelText)) matches.push(labelElement);
    });
    return matches;
  }

  function checkLabels(fixture: ComponentFixture<EnvSettings>, phrase: string): Element[] {
    const labelElements = fixture.nativeElement.querySelectorAll('.env-settings__check');
    const matches: Element[] = [];
    labelElements.forEach((labelElement: Element) => {
      if (labelElement.textContent?.includes(phrase)) matches.push(labelElement);
    });
    return matches;
  }

  it('emits the environment with a changed name', () => {
    const sourceEnvironment = createEnvironment('Staging');
    const { fixture, emittedEnvironments } = buildFixture(sourceEnvironment);
    const nameInput = fieldInput(fixture, 'Name');
    nameInput.value = 'Production';
    nameInput.dispatchEvent(new Event('change'));
    expect(emittedEnvironments.at(-1)?.name).toBe('Production');
    expect(emittedEnvironments.at(-1)?.uuid).toBe(sourceEnvironment.uuid);
  });

  it('clamps the port into the 1–65535 range', () => {
    const sourceEnvironment = createEnvironment('Staging', 3000);
    const { fixture, emittedEnvironments } = buildFixture(sourceEnvironment);
    const portInput = fieldInput(fixture, 'Port');
    portInput.value = '99999';
    portInput.dispatchEvent(new Event('change'));
    expect(emittedEnvironments.at(-1)?.port).toBe(65535);
    portInput.value = '0';
    portInput.dispatchEvent(new Event('change'));
    expect(emittedEnvironments.at(-1)?.port).toBe(1);
  });

  it('reveals the proxy host field when proxy mode is enabled', () => {
    const sourceEnvironment = createEnvironment('Staging');
    const { fixture, emittedEnvironments } = buildFixture(sourceEnvironment);
    expect(findFieldInput(fixture, 'Proxy host')).toBeNull();
    const proxyModeCheck = checkInput(fixture, 'Forward unmatched requests');
    proxyModeCheck.click();
    proxyModeCheck.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emittedEnvironments.at(-1)?.proxyMode).toBe(true);
    const proxyHostInput = findFieldInput(fixture, 'Proxy host');
    expect(proxyHostInput).not.toBeNull();
    (proxyHostInput as HTMLInputElement).value = 'https://real.example.com';
    (proxyHostInput as HTMLInputElement).dispatchEvent(new Event('change'));
    expect(emittedEnvironments.at(-1)?.proxyHost).toBe('https://real.example.com');
  });

  it('emits a TLS clone (not a mutation) when TLS is enabled', () => {
    const sourceEnvironment = createEnvironment('Staging');
    const originalTls = sourceEnvironment.tlsOptions;
    const { fixture, emittedEnvironments } = buildFixture(sourceEnvironment);
    const tlsCheck = checkInput(fixture, 'Serve the mock over HTTPS');
    tlsCheck.click();
    tlsCheck.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const emittedEnvironment = emittedEnvironments.at(-1);
    expect(emittedEnvironment?.tlsOptions.enabled).toBe(true);
    expect(emittedEnvironment?.tlsOptions).not.toBe(originalTls);
    expect(originalTls.enabled).toBe(false);
  });

  it('emits closed when the modal close button is clicked', () => {
    const sourceEnvironment = createEnvironment('Staging');
    const { fixture, emittedCloses } = buildFixture(sourceEnvironment);
    const closeButton = fixture.nativeElement.querySelector('.modal__close') as HTMLButtonElement;
    closeButton.click();
    expect(emittedCloses.count).toBe(1);
  });
});
