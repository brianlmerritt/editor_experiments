import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { maskCredential, readStoredProviderProfiles, upsertStoredProviderProfile, writeStoredOpenRouterSettings } from './provider-settings';

let temporaryDirectory: string | undefined;
const originalPath = process.env.PROVIDER_SETTINGS_PATH;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
  if (originalPath === undefined) delete process.env.PROVIDER_SETTINGS_PATH;
  else process.env.PROVIDER_SETTINGS_PATH = originalPath;
});

function temporaryPath(): string {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'margin-note-provider-'));
  const path = join(temporaryDirectory, 'provider-settings.json');
  process.env.PROVIDER_SETTINGS_PATH = path;
  return path;
}

describe('provider settings', () => {
  it('migrates a legacy OpenRouter file and writes owner-only profile storage', () => {
    const path = temporaryPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ openrouter: { key: 'sk-or-secret-456', model: 'provider/model' } }));

    expect(readStoredProviderProfiles()).toEqual([{
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1', key: 'sk-or-secret-456', model: 'provider/model'
    }]);

    writeStoredOpenRouterSettings({ key: 'sk-or-new-789', model: 'new/model' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 2,
      profiles: [{
        id: 'openrouter', name: 'OpenRouter', protocol: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1', key: 'sk-or-new-789', model: 'new/model'
      }]
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('retains an existing key when a profile model is edited', () => {
    temporaryPath();
    upsertStoredProviderProfile({ id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', key: 'secret', model: 'old' });
    upsertStoredProviderProfile({ id: 'anthropic', name: 'Anthropic direct', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'new' });

    expect(readStoredProviderProfiles()[0]).toMatchObject({ name: 'Anthropic direct', key: 'secret', model: 'new' });
  });

  it('returns only a masked credential hint for display', () => {
    expect(maskCredential('sk-or-secret-456')).toBe('sk-or******456');
  });
});
