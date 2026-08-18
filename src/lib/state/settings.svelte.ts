import { get, writable, type Writable } from 'svelte/store';
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

export interface SettingsStore extends Writable<SettingsSnapshot> {
  load(sourceAvailability: Record<string, SourceAvailability>): void;
  openOpenRouter(): void;
  closeOpenRouter(): void;
  saveOpenRouter(): Promise<SourceAvailability>;
  sourceAvailable(sourceId: string): boolean;
  canSaveOpenRouter(): boolean;
  availability(sourceId: string): SourceAvailability;
  openRouter(): SourceAvailability;
}

export function createSettingsStore(facade: WorkspaceFacade = workspaceFacade): SettingsStore {
  const store = writable(initialSettings());
  const openRouter = (): SourceAvailability => get(store).sourceAvailability.openrouter
    ?? { available: false, reason: 'OpenRouter availability was not reported.' };

  return {
    subscribe: store.subscribe,
    set: store.set,
    update: store.update,
    load(sourceAvailability) {
      store.update((state) => ({
        ...state,
        sourceAvailability: { ...unavailableSources(), ...sourceAvailability }
      }));
    },
    openOpenRouter() {
      store.update((state) => ({
        ...state,
        openRouterDialogOpen: true,
        openRouterKey: '',
        openRouterModel: openRouter().model ?? '',
        error: null
      }));
    },
    closeOpenRouter() {
      store.update((state) => ({ ...state, openRouterDialogOpen: false, openRouterKey: '', error: null }));
    },
    async saveOpenRouter() {
      const current = get(store);
      if (!this.canSaveOpenRouter()) throw new Error('Enter an OpenRouter API key and model.');
      store.update((state) => ({ ...state, savingProvider: true, error: null }));
      try {
        const availability = await facade.configureOpenRouter(current.openRouterKey, current.openRouterModel);
        const configured = availability.openrouter ?? { available: false, reason: 'OpenRouter configuration was not returned.' };
        store.update((state) => ({
          ...state,
          sourceAvailability: { ...state.sourceAvailability, ...availability },
          openRouterDialogOpen: false,
          openRouterKey: ''
        }));
        return configured;
      } catch (error) {
        store.update((state) => ({
          ...state,
          error: error instanceof Error ? error.message : 'OpenRouter configuration failed'
        }));
        throw error;
      } finally {
        store.update((state) => ({ ...state, savingProvider: false }));
      }
    },
    sourceAvailable(sourceId) {
      return get(store).sourceAvailability[sourceId]?.available !== false;
    },
    canSaveOpenRouter() {
      const state = get(store);
      return Boolean(state.openRouterModel.trim()) && (Boolean(state.openRouterKey.trim()) || openRouter().available);
    },
    availability(sourceId) {
      return get(store).sourceAvailability[sourceId] ?? { available: false, reason: 'Source availability was not reported.' };
    },
    openRouter
  };
}

export const settings = createSettingsStore();
