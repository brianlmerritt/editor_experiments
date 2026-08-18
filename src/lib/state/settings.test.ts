import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFacade, type FetchLike } from '$lib/workspace/facade';
import { get } from 'svelte/store';
import { createSettingsStore } from './settings.svelte';

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
    const state = createSettingsStore(new WorkspaceFacade(fetcher));
    state.load({
      openrouter: {
        available: true,
        model: 'anthropic/claude-sonnet-4.5',
        credentialHint: 'sk-or******123',
        persistence: 'local_file'
      }
    });

    state.openOpenRouter();
    expect(get(state).openRouterDialogOpen).toBe(true);
    expect(get(state).openRouterKey).toBe('');
    expect(get(state).openRouterModel).toBe('anthropic/claude-sonnet-4.5');
    expect(state.canSaveOpenRouter()).toBe(true);

    const configured = await state.saveOpenRouter();

    expect(configured.credentialHint).toBe('sk-or******456');
    expect(get(state).openRouterDialogOpen).toBe(false);
    expect(get(state).openRouterKey).toBe('');
  });

  it('requires both explicit fields when no provider is already configured', () => {
    const state = createSettingsStore();
    state.openOpenRouter();
    expect(state.canSaveOpenRouter()).toBe(false);
    state.update((current) => ({ ...current, openRouterKey: 'sk-or-test', openRouterModel: 'provider/model' }));
    expect(state.canSaveOpenRouter()).toBe(true);
  });
});
