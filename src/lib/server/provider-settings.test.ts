import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maskCredential, readStoredOpenRouterSettings, writeStoredOpenRouterSettings } from './provider-settings';

let temporaryDirectory: string | undefined;
const originalPath = process.env.PROVIDER_SETTINGS_PATH;

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
  if (originalPath === undefined) delete process.env.PROVIDER_SETTINGS_PATH;
  else process.env.PROVIDER_SETTINGS_PATH = originalPath;
});

describe('provider settings', () => {
  it('persists OpenRouter settings in an owner-only ignored file', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'margin-note-provider-'));
    const path = join(temporaryDirectory, 'provider-settings.json');
    process.env.PROVIDER_SETTINGS_PATH = path;

    writeStoredOpenRouterSettings({ key: 'sk-or-secret-456', model: 'provider/model' });

    expect(readStoredOpenRouterSettings()).toEqual({ key: 'sk-or-secret-456', model: 'provider/model' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      openrouter: { key: 'sk-or-secret-456', model: 'provider/model' }
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('returns only a masked credential hint for display', () => {
    expect(maskCredential('sk-or-secret-456')).toBe('sk-or******456');
  });
});
