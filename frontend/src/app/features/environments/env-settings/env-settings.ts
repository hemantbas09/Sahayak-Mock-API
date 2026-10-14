import { Component, input, output } from '@angular/core';
import { Environment, KeyValue, TlsOptions } from '../../../core/types';
import { KvList } from '../../../shared/components/kv-list/kv-list';
import { Modal } from '../../../shared/components/modal/modal';

/**
 * F12 — environment settings modal (name, port, prefix, headers, proxy, TLS).
 * Block: .env-settings
 *
 * Controlled: renders `environmentInput` and emits the mutated clone on
 * every field change. The parent applies it through the store.
 */
@Component({
  selector: 'app-env-settings',
  imports: [KvList, Modal],
  template: `
    <app-modal title="Environment settings" (closed)="closed.emit()">
      @if (environmentInput(); as currentSettings) {
        <div class="env-settings">
          <div class="env-settings__row">
            <label class="env-settings__field env-settings__field--grow">
              <span class="env-settings__label">Name</span>
              <input
                type="text"
                class="env-settings__input"
                [value]="currentSettings.name"
                (change)="setStringField('name', $event)"
              />
            </label>
            <label class="env-settings__field">
              <span class="env-settings__label">Port</span>
              <input
                type="number"
                class="env-settings__input env-settings__input--narrow"
                min="1"
                max="65535"
                [value]="currentSettings.port"
                (change)="setPortField($event)"
              />
            </label>
            <label class="env-settings__field">
              <span class="env-settings__label">Endpoint prefix</span>
              <input
                type="text"
                class="env-settings__input env-settings__input--grow"
                placeholder="/api/v1"
                [value]="currentSettings.endpointPrefix"
                (change)="setStringField('endpointPrefix', $event)"
              />
            </label>
          </div>

          <div class="env-settings__section">
            <p class="env-settings__section-label">Default response headers</p>
            <app-kv-list
              [itemsInput]="currentSettings.headers"
              keyPlaceholderInput="Header name"
              valuePlaceholderInput="Value (templating ok)"
              (itemsChange)="setHeaders($event)"
            />
          </div>

          <div class="env-settings__section">
            <p class="env-settings__section-label">Proxy (route fallback)</p>
            <label class="env-settings__check">
              <input
                type="checkbox"
                [checked]="currentSettings.proxyMode"
                (change)="setProxyMode($event)"
              />
              <span>Forward unmatched requests to a real server</span>
            </label>
            @if (currentSettings.proxyMode) {
              <div class="env-settings__row">
                <label class="env-settings__field env-settings__field--grow">
                  <span class="env-settings__label">Proxy host</span>
                  <input
                    type="text"
                    class="env-settings__input"
                    placeholder="https://api.example.com"
                    [value]="currentSettings.proxyHost"
                    (change)="setStringField('proxyHost', $event)"
                  />
                </label>
                <label class="env-settings__check">
                  <input
                    type="checkbox"
                    [checked]="currentSettings.proxyRemovePrefix"
                    (change)="setProxyRemovePrefix($event)"
                  />
                  <span>Strip endpoint prefix before forwarding</span>
                </label>
              </div>
            }
          </div>

          <div class="env-settings__section">
            <p class="env-settings__section-label">TLS</p>
            <label class="env-settings__check">
              <input
                type="checkbox"
                [checked]="currentSettings.tlsOptions.enabled"
                (change)="setTlsEnabled($event)"
              />
              <span>Serve the mock over HTTPS</span>
            </label>
            @if (currentSettings.tlsOptions.enabled) {
              <div class="env-settings__row">
                <label class="env-settings__field env-settings__field--grow">
                  <span class="env-settings__label">Certificate path</span>
                  <input
                    type="text"
                    class="env-settings__input"
                    placeholder="/etc/ssl/certs/mock.crt"
                    [value]="currentSettings.tlsOptions.certPath"
                    (change)="setTlsField('certPath', $event)"
                  />
                </label>
                <label class="env-settings__field env-settings__field--grow">
                  <span class="env-settings__label">Key path</span>
                  <input
                    type="text"
                    class="env-settings__input"
                    placeholder="/etc/ssl/private/mock.key"
                    [value]="currentSettings.tlsOptions.keyPath"
                    (change)="setTlsField('keyPath', $event)"
                  />
                </label>
              </div>
              <div class="env-settings__row">
                <label class="env-settings__field env-settings__field--grow">
                  <span class="env-settings__label">Key passphrase</span>
                  <input
                    type="password"
                    class="env-settings__input"
                    [value]="currentSettings.tlsOptions.passphrase"
                    (change)="setTlsField('passphrase', $event)"
                  />
                </label>
              </div>
            }
          </div>

          <p class="env-settings__hint">
            Settings apply on Save. Changing the port or TLS restarts this environment's listener.
          </p>
        </div>
      }
    </app-modal>
  `,
  styleUrl: './env-settings.scss',
})
export class EnvSettings {
  readonly environmentInput = input<Environment | null>(null);
  readonly environmentChange = output<Environment>();
  readonly closed = output<void>();

  setStringField(field: 'name' | 'endpointPrefix' | 'proxyHost', changeEvent: Event): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    const nextValue = (changeEvent.target as HTMLInputElement).value;
    this.environmentChange.emit({ ...sourceEnvironment, [field]: nextValue });
  }

  setPortField(changeEvent: Event): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    const parsedPort = Number.parseInt((changeEvent.target as HTMLInputElement).value, 10);
    if (!Number.isFinite(parsedPort)) return;
    const clampedPort = Math.min(65535, Math.max(1, parsedPort));
    this.environmentChange.emit({ ...sourceEnvironment, port: clampedPort });
  }

  setHeaders(nextHeaders: KeyValue[]): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    this.environmentChange.emit({ ...sourceEnvironment, headers: nextHeaders });
  }

  setProxyMode(changeEvent: Event): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    this.environmentChange.emit({ ...sourceEnvironment, proxyMode: (changeEvent.target as HTMLInputElement).checked });
  }

  setProxyRemovePrefix(changeEvent: Event): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    this.environmentChange.emit({
      ...sourceEnvironment,
      proxyRemovePrefix: (changeEvent.target as HTMLInputElement).checked,
    });
  }

  setTlsEnabled(changeEvent: Event): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    const nextTls: TlsOptions = { ...sourceEnvironment.tlsOptions, enabled: (changeEvent.target as HTMLInputElement).checked };
    this.environmentChange.emit({ ...sourceEnvironment, tlsOptions: nextTls });
  }

  setTlsField(field: 'certPath' | 'keyPath' | 'passphrase', changeEvent: Event): void {
    const sourceEnvironment = this.environmentInput();
    if (!sourceEnvironment) return;
    const nextValue = (changeEvent.target as HTMLInputElement).value;
    const nextTls: TlsOptions = { ...sourceEnvironment.tlsOptions, [field]: nextValue };
    this.environmentChange.emit({ ...sourceEnvironment, tlsOptions: nextTls });
  }
}
