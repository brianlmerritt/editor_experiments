import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFacade, type FetchLike } from '$lib/workspace/facade';
import { createSettingsState } from './settings.svelte';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Svelte settings state', () => {
  it('owns the editable provider form and replaces availability after saving', async () => {
    const fetcher = vi.fn<FetchLike>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        kind: 'provider',
        source: 'openrouter',
        key: '',
        model: 'anthropic/claude-sonnet-4.5'
      });
      return json({ sourceAvailability: {
        openrouter: {
          available: true,
          model: 'anthropic/claude-sonnet-4.5',
          credentialHint: 'sk-or******456',
          persistence: 'local_file'
        }
      } });
    });
    const state = createSettingsState(new WorkspaceFacade(fetcher));
    state.load({
      openrouter: {
        available: true,
        model: 'anthropic/claude-sonnet-4.5',
        credentialHint: 'sk-or******123',
        persistence: 'local_file'
      }
    });

    state.openOpenRouter();
    expect(state.openRouterDialogOpen).toBe(true);
    expect(state.openRouterKey).toBe('');
    expect(state.openRouterModel).toBe('anthropic/claude-sonnet-4.5');

    const configured = await state.saveOpenRouter();

    expect(configured.credentialHint).toBe('sk-or******456');
    expect(state.openRouterDialogOpen).toBe(false);
    expect(state.openRouterKey).toBe('');
  });

  it('requires both explicit fields when no provider is already configured', async () => {
    const state = createSettingsState();
    state.openOpenRouter();
    expect(state.openRouterModel).toBe('anthropic/claude-fable-5');
    await expect(state.saveOpenRouter({ key: '', model: '' })).rejects.toThrow('neither an OpenRouter API key nor a model ID');
    expect(state.error).toBe('The form submitted neither an OpenRouter API key nor a model ID.');
    state.openRouterKey = 'sk-or-test';
    state.openRouterModel = 'provider/model';
    expect(state.openRouterKey).toBe('sk-or-test');
  });

  it('validates and saves the submitted form values rather than stale reactive fields', async () => {
    const fetcher = vi.fn<FetchLike>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        key: 'sk-or-submitted-456',
        model: 'anthropic/claude-fable-5'
      });
      return json({ sourceAvailability: {
        openrouter: { available: true, model: 'anthropic/claude-fable-5', credentialHint: 'sk-or******456' }
      } });
    });
    const state = createSettingsState(new WorkspaceFacade(fetcher));

    const configured = await state.saveOpenRouter({
      key: 'sk-or-submitted-456',
      model: 'anthropic/claude-fable-5'
    });

    expect(configured.available).toBe(true);
    expect(configured.credentialHint).toBe('sk-or******456');
  });
});
