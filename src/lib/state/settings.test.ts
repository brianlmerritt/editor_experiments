import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFacade, type FetchLike } from '$lib/workspace/facade';
import { createSettingsState, providerPresetFor } from './settings.svelte';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Svelte settings state', () => {
  it('identifies the selected provider service from protocol and endpoint', () => {
    expect(providerPresetFor({ protocol: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1/' })).toBe('openrouter');
    expect(providerPresetFor({ protocol: 'openai_compatible', baseUrl: 'https://api.openai.com/v1' })).toBe('openai');
    expect(providerPresetFor({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' })).toBe('anthropic');
    expect(providerPresetFor({ protocol: 'openai_compatible', baseUrl: 'http://localhost:11434/v1' })).toBe('ollama');
    expect(providerPresetFor({ protocol: 'openai_compatible', baseUrl: 'https://example.test/v1' })).toBeNull();
  });

  it('owns a named provider form and adds the configured source', async () => {
    const fetcher = vi.fn<FetchLike>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        kind: 'provider_profile',
        profile: {
          id: 'anthropic', name: 'Anthropic', protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1', key: 'sk-ant-secret', model: 'claude-test'
        }
      });
      return json({
        profileId: 'anthropic',
        sourceAvailability: {
          anthropic: {
            available: true, name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
            model: 'claude-test', sourceNumber: 3, credentialHint: 'sk-an******ret', persistence: 'local_file'
          }
        }
      });
    });
    const state = createSettingsState(new WorkspaceFacade(fetcher));
    state.openProviders();
    state.usePreset('anthropic');

    expect(state.providerDialogOpen).toBe(true);
    expect(state.providerForm).toMatchObject({ id: '', protocol: 'anthropic' });

    const configured = await state.saveProvider({
      id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
      key: 'sk-ant-secret', model: 'claude-test'
    });

    expect(configured.id).toBe('anthropic');
    expect(configured.availability.credentialHint).toBe('sk-an******ret');
    expect(state.providerDialogOpen).toBe(false);
    expect(state.sources.map((source) => source.id)).toEqual(['local-craft', 'fake-sentinel', 'anthropic']);
  });

  it('requires provider name, endpoint, and model before transport', async () => {
    const state = createSettingsState();
    await expect(state.saveProvider({ name: '', protocol: 'openai_compatible', baseUrl: '', model: '' }))
      .rejects.toThrow('Provider name, base URL, and model are required');
    expect(state.error).toBe('Provider name, base URL, and model are required.');
  });

  it('can save a provider and reset the form without closing the provider dialog', async () => {
    const fetcher = vi.fn<FetchLike>(async () => json({
      profileId: 'openai',
      sourceAvailability: {
        openai: {
          available: true, name: 'OpenAI', protocol: 'openai_compatible', baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-test', sourceNumber: 3, credentialHint: 'sk-te******key', persistence: 'local_file'
        }
      }
    }));
    const state = createSettingsState(new WorkspaceFacade(fetcher));
    state.openProviders();
    state.usePreset('openai');

    await state.saveProvider({
      id: 'openai', name: 'OpenAI', protocol: 'openai_compatible', baseUrl: 'https://api.openai.com/v1',
      key: 'sk-test-key', model: 'gpt-test'
    }, { keepOpen: true });

    expect(state.providerDialogOpen).toBe(true);
    expect(state.providerForm).toEqual({
      id: '', name: 'OpenRouter', protocol: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1', key: '', model: ''
    });
    expect(state.sources.map((source) => source.id)).toContain('openai');
  });

  it('uses the most recently selected service for the next new provider', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    const state = createSettingsState();
    state.openProviders();
    state.usePreset('anthropic');
    state.closeProviders();
    state.openProviders();

    expect(state.providerForm).toMatchObject({ name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' });
    vi.unstubAllGlobals();
  });

  it('loads and edits masked profiles without exposing saved credentials', () => {
    const state = createSettingsState();
    state.load({
      openrouter: {
        available: true, name: 'OpenRouter', protocol: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-fable-5', sourceNumber: 3, credentialHint: 'sk-or******123', persistence: 'local_file'
      }
    });

    state.openProviders('openrouter');

    expect(state.providerForm).toEqual({
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1', key: '', model: 'anthropic/claude-fable-5'
    });
    expect(state.sourceAvailability.openrouter.credentialHint).toBe('sk-or******123');
  });
});
