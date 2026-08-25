import { sourceCatalog, type ProviderProfileInput, type ProviderProtocol, type SourceAvailability } from '$lib/domain';
import { workspaceFacade, type WorkspaceFacade } from '$lib/workspace/facade';

export interface ProviderForm {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  key: string;
  model: string;
}

export type ProviderPreset = 'openrouter' | 'openai' | 'anthropic' | 'ollama';
const providerPresetStorageKey = 'margin-note:last-provider-service';

function rememberProviderPreset(preset: ProviderPreset): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(providerPresetStorageKey, preset); } catch { /* Browser storage may be unavailable. */ }
}

function rememberedProviderPreset(): ProviderPreset {
  if (typeof localStorage === 'undefined') return 'openrouter';
  try {
    const stored = localStorage.getItem(providerPresetStorageKey);
    return stored === 'openrouter' || stored === 'openai' || stored === 'anthropic' || stored === 'ollama'
      ? stored
      : 'openrouter';
  } catch {
    return 'openrouter';
  }
}

export function providerPresetFor(form: Pick<ProviderForm, 'protocol' | 'baseUrl'>): ProviderPreset | null {
  const baseUrl = form.baseUrl.trim().replace(/\/$/, '').toLowerCase();
  if (form.protocol === 'openai_compatible' && baseUrl === 'https://openrouter.ai/api/v1') return 'openrouter';
  if (form.protocol === 'openai_compatible' && baseUrl === 'https://api.openai.com/v1') return 'openai';
  if (form.protocol === 'anthropic' && baseUrl === 'https://api.anthropic.com/v1') return 'anthropic';
  if (form.protocol === 'openai_compatible' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/v1$/.test(baseUrl)) return 'ollama';
  return null;
}

export interface SettingsSource {
  id: string;
  number: number;
  kind: 'local' | 'ai';
  label: string;
}

export interface SettingsSnapshot {
  sourceAvailability: Record<string, SourceAvailability>;
  providerDialogOpen: boolean;
  providerForm: ProviderForm;
  savingProvider: boolean;
  error: string | null;
}

function unavailableSources(): Record<string, SourceAvailability> {
  return Object.fromEntries(sourceCatalog.map((source) => [source.id, { available: true }]));
}

function blankProvider(preset: ProviderPreset = rememberedProviderPreset()): ProviderForm {
  const presets: Record<ProviderPreset, ProviderForm> = {
    openrouter: { id: '', name: 'OpenRouter', protocol: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1', key: '', model: '' },
    openai: { id: '', name: 'OpenAI', protocol: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', key: '', model: '' },
    anthropic: { id: '', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', key: '', model: '' },
    ollama: { id: '', name: 'Ollama', protocol: 'openai_compatible', baseUrl: 'http://127.0.0.1:11434/v1', key: '', model: '' }
  };
  return { ...presets[preset] };
}

function initialSettings(): SettingsSnapshot {
  return {
    sourceAvailability: unavailableSources(),
    providerDialogOpen: false,
    providerForm: blankProvider(),
    savingProvider: false,
    error: null
  };
}

export function createSettingsState(facade: WorkspaceFacade = workspaceFacade) {
  let state = $state<SettingsSnapshot>(initialSettings());

  const availability = (sourceId: string): SourceAvailability => state.sourceAvailability[sourceId]
    ?? { available: false, reason: 'Source availability was not reported.' };

  const providerSources = (): SettingsSource[] => Object.entries(state.sourceAvailability)
    .filter(([id, item]) => !sourceCatalog.some((source) => source.id === id) && Boolean(item.protocol))
    .map(([id, item], index) => ({
      id,
      number: item.sourceNumber ?? index + 3,
      kind: 'ai' as const,
      label: item.name ?? id
    }))
    .sort((left, right) => left.number - right.number || left.label.localeCompare(right.label));

  const applyAvailability = (next: Record<string, SourceAvailability>) => {
    state.sourceAvailability = { ...unavailableSources(), ...next };
  };

  return {
    get sourceAvailability() { return state.sourceAvailability; },
    get sources(): SettingsSource[] { return [...sourceCatalog, ...providerSources()]; },
    get providerDialogOpen() { return state.providerDialogOpen; },
    get providerForm() { return state.providerForm; },
    get savingProvider() { return state.savingProvider; },
    get error() { return state.error; },
    load(sourceAvailability: Record<string, SourceAvailability>) {
      applyAvailability(sourceAvailability);
    },
    openProviders(sourceId?: string) {
      state.providerDialogOpen = true;
      state.error = null;
      if (sourceId) {
        const profile = availability(sourceId);
        state.providerForm = {
          id: sourceId,
          name: profile.name ?? sourceId,
          protocol: profile.protocol ?? 'openai_compatible',
          baseUrl: profile.baseUrl ?? '',
          key: '',
          model: profile.model ?? ''
        };
        const preset = providerPresetFor(state.providerForm);
        if (preset) rememberProviderPreset(preset);
      } else state.providerForm = blankProvider();
    },
    usePreset(preset: ProviderPreset) {
      rememberProviderPreset(preset);
      state.providerForm = { ...blankProvider(preset), id: state.providerForm.id };
      state.error = null;
    },
    setProviderField<K extends keyof ProviderForm>(field: K, value: ProviderForm[K]) {
      state.providerForm = { ...state.providerForm, [field]: value };
    },
    closeProviders() {
      state.providerDialogOpen = false;
      state.providerForm = blankProvider();
      state.error = null;
    },
    async saveProvider(
      input?: ProviderProfileInput,
      options: { keepOpen?: boolean } = {}
    ): Promise<{ id: string; availability: SourceAvailability }> {
      const profile: ProviderProfileInput = input ?? {
        id: state.providerForm.id || undefined,
        name: state.providerForm.name,
        protocol: state.providerForm.protocol,
        baseUrl: state.providerForm.baseUrl,
        key: state.providerForm.key,
        model: state.providerForm.model
      };
      if (!profile.name.trim() || !profile.baseUrl.trim() || !profile.model.trim()) {
        state.error = 'Provider name, base URL, and model are required.';
        throw new Error(state.error);
      }
      state.savingProvider = true;
      state.error = null;
      try {
        const result = await facade.configureProvider(profile);
        applyAvailability(result.sourceAvailability);
        const preset = providerPresetFor(profile);
        if (preset) rememberProviderPreset(preset);
        state.providerDialogOpen = options.keepOpen === true;
        state.providerForm = blankProvider();
        return { id: result.profileId, availability: availability(result.profileId) };
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'Provider configuration failed';
        throw error;
      } finally {
        state.savingProvider = false;
      }
    },
    async deleteProvider(id: string): Promise<void> {
      state.savingProvider = true;
      state.error = null;
      try {
        applyAvailability(await facade.deleteProvider(id));
        state.providerForm = blankProvider();
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'Provider removal failed';
        throw error;
      } finally {
        state.savingProvider = false;
      }
    },
    sourceAvailable(sourceId: string): boolean {
      return availability(sourceId).available !== false;
    },
    availability
  };
}

export type SettingsState = ReturnType<typeof createSettingsState>;
export const settings = createSettingsState();
