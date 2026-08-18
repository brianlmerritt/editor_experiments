import { sourceCatalog, type SourceAvailability } from '$lib/domain';
import { workspaceFacade, type WorkspaceFacade } from '$lib/workspace/facade';

export interface SettingsSnapshot {
  sourceAvailability: Record<string, SourceAvailability>;
  openRouterDialogOpen: boolean;
  openRouterKey: string;
  openRouterModel: string;
  savingProvider: boolean;
  error: string | null;
}

function unavailableSources(): Record<string, SourceAvailability> {
  return Object.fromEntries(sourceCatalog.map((source) => [source.id, {
    available: source.id === 'local-craft' || source.id === 'fake-sentinel'
  }]));
}

function initialSettings(): SettingsSnapshot {
  return {
    sourceAvailability: unavailableSources(),
    openRouterDialogOpen: false,
    openRouterKey: '',
    openRouterModel: '',
    savingProvider: false,
    error: null
  };
}

export function createSettingsState(facade: WorkspaceFacade = workspaceFacade) {
  let state = $state<SettingsSnapshot>(initialSettings());
  const openRouter = (): SourceAvailability => state.sourceAvailability.openrouter
    ?? { available: false, reason: 'OpenRouter availability was not reported.' };

  return {
    get sourceAvailability() { return state.sourceAvailability; },
    get openRouterDialogOpen() { return state.openRouterDialogOpen; },
    get openRouterKey() { return state.openRouterKey; },
    set openRouterKey(value: string) { state.openRouterKey = value; },
    get openRouterModel() { return state.openRouterModel; },
    set openRouterModel(value: string) { state.openRouterModel = value; },
    get savingProvider() { return state.savingProvider; },
    get error() { return state.error; },
    load(sourceAvailability: Record<string, SourceAvailability>) {
      state.sourceAvailability = { ...unavailableSources(), ...sourceAvailability };
    },
    openOpenRouter() {
      state.openRouterDialogOpen = true;
      state.openRouterKey = '';
      state.openRouterModel = openRouter().model ?? 'anthropic/claude-fable-5';
      state.error = null;
    },
    closeOpenRouter() {
      state.openRouterDialogOpen = false;
      state.openRouterKey = '';
      state.error = null;
    },
    async saveOpenRouter(input?: { key: string; model: string }): Promise<SourceAvailability> {
      const key = (input?.key ?? state.openRouterKey).trim();
      const model = (input?.model ?? state.openRouterModel).trim();
      state.openRouterKey = key;
      state.openRouterModel = model;
      const keyMissing = !key && !openRouter().available;
      if (keyMissing || !model) {
        state.error = keyMissing && !model
          ? 'The form submitted neither an OpenRouter API key nor a model ID.'
          : keyMissing
            ? 'The form submitted no OpenRouter API key.'
            : 'The form submitted no OpenRouter model ID.';
        throw new Error(state.error);
      }
      state.savingProvider = true;
      state.error = null;
      try {
        const availability = await facade.configureOpenRouter(key, model);
        state.sourceAvailability = { ...state.sourceAvailability, ...availability };
        const configured = openRouter();
        state.openRouterDialogOpen = false;
        state.openRouterKey = '';
        return configured;
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'OpenRouter configuration failed';
        throw error;
      } finally {
        state.savingProvider = false;
      }
    },
    sourceAvailable(sourceId: string): boolean {
      return state.sourceAvailability[sourceId]?.available !== false;
    },
    availability(sourceId: string): SourceAvailability {
      return state.sourceAvailability[sourceId] ?? { available: false, reason: 'Source availability was not reported.' };
    },
    openRouter
  };
}

export type SettingsState = ReturnType<typeof createSettingsState>;
export const settings = createSettingsState();
