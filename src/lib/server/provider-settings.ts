import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ProviderProfileInput, ProviderProtocol } from '$lib/domain';

export interface StoredOpenRouterSettings {
  key?: string;
  model?: string;
}

export interface StoredProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  key?: string;
}

interface StoredProviderSettings {
  version?: 2;
  profiles?: StoredProviderProfile[];
  openrouter?: StoredOpenRouterSettings;
}

function settingsPath(): string {
  return process.env.PROVIDER_SETTINGS_PATH ?? resolve('data/provider-settings.json');
}

function readSettings(): StoredProviderSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8')) as StoredProviderSettings;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw new Error(`Could not read local provider settings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function legacyOpenRouter(settings: StoredProviderSettings): StoredProviderProfile[] {
  const legacy = settings.openrouter;
  return legacy?.model ? [{
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: legacy.model,
    key: legacy.key
  }] : [];
}

export function readStoredProviderProfiles(): StoredProviderProfile[] {
  const settings = readSettings();
  const profiles = Array.isArray(settings.profiles) ? settings.profiles : legacyOpenRouter(settings);
  return profiles.filter((profile) => profile && typeof profile.id === 'string' && typeof profile.name === 'string'
    && (profile.protocol === 'openai_compatible' || profile.protocol === 'anthropic' || profile.protocol === 'codex_app_server')
    && typeof profile.baseUrl === 'string' && typeof profile.model === 'string');
}

export function writeStoredProviderProfiles(profiles: StoredProviderProfile[]): void {
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 2, profiles }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

export function upsertStoredProviderProfile(input: ProviderProfileInput): StoredProviderProfile {
  const profiles = readStoredProviderProfiles();
  const id = input.id?.trim() || `provider_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Provider profile ID may contain only letters, numbers, underscores, and hyphens.');
  const existing = profiles.find((profile) => profile.id === id);
  const profile: StoredProviderProfile = {
    id,
    name: input.name.trim(),
    protocol: input.protocol,
    baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
    model: input.model.trim(),
    key: input.key?.trim() || existing?.key
  };
  if (!profile.name || !profile.baseUrl || !profile.model) throw new Error('Provider name, base URL, and model are required.');
  if (profile.protocol !== 'codex_app_server' && !profile.key && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(profile.baseUrl)) {
    throw new Error('A remote provider requires an API key.');
  }
  writeStoredProviderProfiles([...profiles.filter((item) => item.id !== id), profile]);
  return profile;
}

export function deleteStoredProviderProfile(id: string): void {
  writeStoredProviderProfiles(readStoredProviderProfiles().filter((profile) => profile.id !== id));
}

export function readStoredOpenRouterSettings(): StoredOpenRouterSettings {
  const profile = readStoredProviderProfiles().find((item) => item.id === 'openrouter');
  return profile ? { key: profile.key, model: profile.model } : {};
}

export function writeStoredOpenRouterSettings(settings: Required<StoredOpenRouterSettings>): void {
  upsertStoredProviderProfile({
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: settings.key,
    model: settings.model
  });
}

export function maskCredential(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}******${trimmed.slice(-3)}`;
}
