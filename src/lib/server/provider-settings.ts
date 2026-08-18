import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface StoredOpenRouterSettings {
  key?: string;
  model?: string;
}

interface StoredProviderSettings {
  openrouter?: StoredOpenRouterSettings;
}

function settingsPath(): string {
  return process.env.PROVIDER_SETTINGS_PATH ?? resolve('data/provider-settings.json');
}

export function readStoredOpenRouterSettings(): StoredOpenRouterSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as StoredProviderSettings;
    return parsed.openrouter ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw new Error(`Could not read local provider settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function writeStoredOpenRouterSettings(settings: Required<StoredOpenRouterSettings>): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ openrouter: settings }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

export function maskCredential(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}******${trimmed.slice(-3)}`;
}
