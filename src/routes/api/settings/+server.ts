import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvent, getBrief, getPrompts } from '$lib/server/ledger';
import { configureProviderProfile, removeProviderProfile, suggestionSourceAvailability } from '$lib/server/suggesters';
import type { ProviderProfileInput, TaskPrompt, WritingBrief } from '$lib/domain';

export const GET: RequestHandler = () => {
  let sourceAvailability;
  let providerSettingsError: string | undefined;
  try {
    sourceAvailability = suggestionSourceAvailability();
  } catch (error) {
    providerSettingsError = error instanceof Error ? error.message : 'Provider settings could not be loaded.';
    console.error('[provider-settings] Writing workspace loaded without AI providers.', error);
    sourceAvailability = {
      'local-craft': { available: true },
      'fake-sentinel': { available: true }
    };
  }
  return json(
    { brief: getBrief(), prompts: getPrompts(), sourceAvailability, providerSettingsError },
    { headers: { 'cache-control': 'no-store' } }
  );
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as
    | { kind: 'brief' | 'prompt'; value: WritingBrief | TaskPrompt; sessionId: string; branchId: string }
    | { kind: 'provider_profile'; profile: ProviderProfileInput }
    | { kind: 'delete_provider_profile'; id: string };
  if (body.kind === 'provider_profile') {
    try {
      const profile = configureProviderProfile(body.profile);
      return json({ profileId: profile.id, sourceAvailability: suggestionSourceAvailability() }, { status: 201 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Provider configuration failed' }, { status: 400 });
    }
  }
  if (body.kind === 'delete_provider_profile') {
    try {
      removeProviderProfile(body.id);
      return json({ sourceAvailability: suggestionSourceAvailability() }, { status: 201 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Provider configuration failed' }, { status: 400 });
    }
  }
  const type = body.kind === 'brief' ? 'brief_updated' : 'prompt_updated';
  const event = appendEvent({ type, sessionId: body.sessionId, branchId: body.branchId, payload: body.value });
  return json({ event, brief: getBrief(), prompts: getPrompts() }, { status: 201 });
};
