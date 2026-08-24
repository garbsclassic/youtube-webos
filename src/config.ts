const CONFIG_KEY = 'ytaf-configuration';

export const segmentTypes = {
  sponsor: { color: '#00d400', opacity: '0.7', name: 'sponsor' },
  intro: { color: '#00ffff', opacity: '0.7', name: 'intro' },
  outro: { color: '#0202ed', opacity: '0.7', name: 'outro' },
  interaction: { color: '#cc00ff', opacity: '0.7', name: 'interaction reminder' },
  selfpromo: { color: '#ffff00', opacity: '0.7', name: 'self-promotion' },
  musicofftopic: { color: '#ff9900', opacity: '0.7', name: 'non-music segment' },
  preview: { color: '#008fd6', opacity: '0.7', name: 'recap or preview' },
  poi_highlight: { color: '#ff1684', opacity: '0.8', name: 'highlight' },
  filler: { color: '#7300ff', opacity: '0.7', name: 'tangents/jokes' },
  hook: { color: '#395699', opacity: '0.7', name: 'hook/greetings' }
} as const;

export const shortcutActions = {
  none: 'None',
  config_menu: 'Open/Close Settings',
  oled_toggle: 'Toggle OLED Care Mode',
  refresh_page: 'Refresh Page',
  play_pause: 'Play / Pause',
  seek_back: 'Rewind (Burst)',
  seek_back_ex: 'Rewind EX (Burst)',
  seek_fwd: 'Fast Forward (Burst)',
  seek_fwd_ex: 'Fast Forward EX (Burst)',
  chapter_skip_prev: 'Skip to Previous Chapter',
  chapter_skip_next: 'Skip to Next Chapter',
  sb_skip_prev: 'Skip to Last SponsorBlock Segment',
  sb_manual_skip: 'Manual Skip / Jump to Highlight',
  toggle_description: 'Toggle Description',
  toggle_comments: 'Toggle Comments',
  toggle_subs: 'Toggle Subtitles',
  save_to_playlist: 'Save / Watch Later'
} as const;

export const sbModes = {
  auto_skip: 'Auto Skip',
  manual_skip: 'Manual Skip',
  seek_bar: 'Show in Seek Bar',
  disable: 'Disable'
} as const;

export const sbModesHighlight = {
  auto_skip: 'Auto Skip to Start',
  ask: 'Ask when video loads',
  seek_bar: 'Show in Seek Bar',
  disable: 'Disable'
} as const;

export const forcePreviewModes = {
  disabled: 'Disabled',
  force_on: 'Force On',
  force_off: 'Force Off'
} as const;

type UITheme = 'blue-force-field' | 'classic-red';
type ShortcutAction = keyof typeof shortcutActions;
type SBMode = keyof typeof sbModes;
type SBModeHighlight = keyof typeof sbModesHighlight;
type ForcePreviewMode = keyof typeof forcePreviewModes;

interface ConfigOptionDef<T> {
  readonly default: T;
  readonly desc: string;
}

function opt<T>(defaultValue: T, desc: string): ConfigOptionDef<T> {
  return { default: defaultValue, desc };
}

const configSchema = {
  uiTheme: opt<UITheme>('blue-force-field', 'UI Theme'),
  enableAdBlock: opt(true, 'Ad Blocking'),
  enableTrackingBlock: opt(false, 'Reduce Telemetry & Tracking'),
  enableReturnYouTubeDislike: opt(true, 'Return YouTube Dislike'),
  upgradeThumbnails: opt(false, 'Max Thumbnail Quality'),
  removeGlobalShorts: opt(false, 'Remove Shorts (Global)'),
  removeTopLiveGames: opt(false, 'Remove Top Live Games'),
  removeMostRelevant: opt(false, 'Remove "Most Relevant" Shelf'),
  enableSponsorBlock: opt(true, 'SponsorBlock'),
  enableMutedSegments: opt(false, 'Allow segments that mute audio'),
  skipSegmentsOnce: opt(false, 'Skip Segments Once'),
  sbMode_sponsor: opt<SBMode>('auto_skip', 'Sponsor'),
  sbMode_intro: opt<SBMode>('auto_skip', 'Intermission/Intro'),
  sbMode_outro: opt<SBMode>('auto_skip', 'Endcards/Credits'),
  sbMode_interaction: opt<SBMode>('auto_skip', 'Interaction Reminder'),
  sbMode_selfpromo: opt<SBMode>('auto_skip', 'Self Promotion'),
  sbMode_musicofftopic: opt<SBMode>('auto_skip', 'Non-Music Section'),
  sbMode_preview: opt<SBMode>('seek_bar', 'Preview/Recap'),
  sbMode_filler: opt<SBMode>('seek_bar', 'Filler/Tangents'),
  sbMode_hook: opt<SBMode>('seek_bar', 'Hook/Greetings'),
  sbMode_highlight: opt<SBModeHighlight>('seek_bar', 'Highlight'),
  hideEndcards: opt(false, 'Hide Endcards'),
  enableAutoLogin: opt(true, 'Auto Login'),
  hideLogo: opt(false, 'Hide YouTube Logo'),
  showWatch: opt(false, 'Display Time in UI'),
  enableOledCareMode: opt(false, 'OLED-Care Mode (True Black UI)'),
  videoShelfOpacity: opt(100, 'Video shelf opacity'),
  fixMultilineTitles: opt(true, 'Fix Multiline Titles'),
  removeBlackBorders: opt(false, 'New Liquid Glass UI'),
  forcePreviews: opt<ForcePreviewMode>('disabled', 'Force Previews'),
  hideGuestSignInPrompts: opt(false, 'Guest Mode: Hide Sign-in Buttons'),
  forceHighResVideo: opt(false, 'Force Max Quality'),
  disableNotifications: opt(false, 'Disable Notifications'),

  // Shortcut keys 0-9 (5 defaults to the chapter-skip action)
  shortcut_key_0: opt<ShortcutAction>('none', 'Key 0 Action'),
  shortcut_key_1: opt<ShortcutAction>('none', 'Key 1 Action'),
  shortcut_key_2: opt<ShortcutAction>('none', 'Key 2 Action'),
  shortcut_key_3: opt<ShortcutAction>('none', 'Key 3 Action'),
  shortcut_key_4: opt<ShortcutAction>('none', 'Key 4 Action'),
  shortcut_key_5: opt<ShortcutAction>('chapter_skip_next', 'Key 5 Action'),
  shortcut_key_6: opt<ShortcutAction>('none', 'Key 6 Action'),
  shortcut_key_7: opt<ShortcutAction>('none', 'Key 7 Action'),
  shortcut_key_8: opt<ShortcutAction>('none', 'Key 8 Action'),
  shortcut_key_9: opt<ShortcutAction>('none', 'Key 9 Action'),

  // Shortcut keys Red, Green, Blue
  shortcut_key_red: opt<ShortcutAction>('seek_back', 'Red Button Action'),
  shortcut_key_green: opt<ShortcutAction>('config_menu', 'Green Button Action'),
  shortcut_key_blue: opt<ShortcutAction>('seek_fwd', 'Blue Button Action'),

  // Per-category SponsorBlock segment colors
  sponsorColor: opt<string>(segmentTypes.sponsor.color, `Color for ${segmentTypes.sponsor.name}`),
  introColor: opt<string>(segmentTypes.intro.color, `Color for ${segmentTypes.intro.name}`),
  outroColor: opt<string>(segmentTypes.outro.color, `Color for ${segmentTypes.outro.name}`),
  interactionColor: opt<string>(
    segmentTypes.interaction.color,
    `Color for ${segmentTypes.interaction.name}`
  ),
  selfpromoColor: opt<string>(
    segmentTypes.selfpromo.color,
    `Color for ${segmentTypes.selfpromo.name}`
  ),
  musicofftopicColor: opt<string>(
    segmentTypes.musicofftopic.color,
    `Color for ${segmentTypes.musicofftopic.name}`
  ),
  previewColor: opt<string>(segmentTypes.preview.color, `Color for ${segmentTypes.preview.name}`),
  poi_highlightColor: opt<string>(
    segmentTypes.poi_highlight.color,
    `Color for ${segmentTypes.poi_highlight.name}`
  ),
  fillerColor: opt<string>(segmentTypes.filler.color, `Color for ${segmentTypes.filler.name}`),
  hookColor: opt<string>(segmentTypes.hook.color, `Color for ${segmentTypes.hook.name}`)
} satisfies Record<string, ConfigOptionDef<unknown>>;

export type ConfigKey = keyof typeof configSchema;
export type ConfigValue<K extends ConfigKey> = (typeof configSchema)[K]['default'];

const defaultConfig = Object.fromEntries(
  (Object.keys(configSchema) as ConfigKey[]).map(key => [key, configSchema[key].default])
) as { [K in ConfigKey]: ConfigValue<K> };

const changeListeners = new Map<ConfigKey, Set<(evt: ConfigChangeEvent<ConfigKey>) => void>>();

interface ConfigChangeEvent<K extends ConfigKey> {
  detail: {
    key: K;
    newValue: ConfigValue<K>;
    oldValue: ConfigValue<K>;
  };
}

function loadStoredConfig(): Partial<Record<ConfigKey, unknown>> | null {
  try {
    const storage = window.localStorage.getItem(CONFIG_KEY);
    if (storage === null) return null;

    return JSON.parse(storage);
  } catch {
    return null;
  }
}

// MUTATE IN PLACE ONLY — adblock.js (and other modules) hold a module-level
// reference to this object via the configGetAll() snapshot. Reassigning
// localConfig (e.g. for a future "reset to defaults") would silently desync
// those holders. Use Object.assign(localConfig, defaultConfig) to reset.
const localConfig: { [K in ConfigKey]: ConfigValue<K> } = Object.assign(
  {},
  defaultConfig,
  loadStoredConfig() || {}
);

// Debounce localStorage writes — rapid input (e.g. color picker drag) was
// stringifying the entire ~50-key config object on every event.
let pendingWriteTimer: ReturnType<typeof setTimeout> | null = null;
function flushPendingWrite() {
  if (pendingWriteTimer === null) return;
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = null;
  try {
    window.localStorage[CONFIG_KEY as keyof Storage] = JSON.stringify(localConfig);
  } catch {
    /* quota / SecurityError on private mode */
  }
}
function scheduleWrite() {
  if (pendingWriteTimer !== null) return;
  pendingWriteTimer = setTimeout(() => {
    pendingWriteTimer = null;
    try {
      window.localStorage[CONFIG_KEY as keyof Storage] = JSON.stringify(localConfig);
    } catch {
      /* ignore */
    }
  }, 200);
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingWrite);
  window.addEventListener('pagehide', flushPendingWrite);
}

function configExists(key: string): key is ConfigKey {
  return Object.hasOwn(configSchema, key);
}

export function configGetDesc(key: ConfigKey): string {
  if (!configExists(key)) throw new Error('tried to get desc for unknown config key: ' + key);
  return configSchema[key].desc;
}

export function configRead<K extends ConfigKey>(key: K): ConfigValue<K> {
  if (!configExists(key)) throw new Error('tried to read unknown config key: ' + key);
  return localConfig[key];
}

// Gate the per-write log behind a flag — configWrite fires per event during
// color-picker drags / opacity-slider scrubs (the localStorage write itself is
// already debounced).
const DEBUG = false;

export function configWrite<K extends ConfigKey>(key: K, value: ConfigValue<K>): void {
  if (!configExists(key)) throw new Error('tried to write unknown config key: ' + key);
  const oldValue = localConfig[key];
  if (oldValue === value) return;

  DEBUG && console.info('Changing key', key, 'from', oldValue, 'to', value);
  (localConfig as Record<ConfigKey, unknown>)[key] = value;
  scheduleWrite();

  const listeners = changeListeners.get(key);
  if (listeners) {
    const syntheticEvent: ConfigChangeEvent<K> = { detail: { key, newValue: value, oldValue } };
    for (const callback of listeners) {
      callback(syntheticEvent);
    }
  }
}

export function configAddChangeListener<K extends ConfigKey>(
  key: K,
  callback: (evt: ConfigChangeEvent<K>) => void
): void {
  if (!configExists(key)) return;
  if (!changeListeners.has(key)) changeListeners.set(key, new Set());
  changeListeners.get(key)!.add(callback as (evt: ConfigChangeEvent<ConfigKey>) => void);
}

export function configRemoveChangeListener<K extends ConfigKey>(
  key: K,
  callback: (evt: ConfigChangeEvent<K>) => void
): void {
  changeListeners.get(key)?.delete(callback as (evt: ConfigChangeEvent<ConfigKey>) => void);
}

export function configGetDefault<K extends ConfigKey>(key: K): ConfigValue<K> {
  if (!configExists(key)) throw new Error('tried to get default for unknown config key: ' + key);
  return configSchema[key].default as ConfigValue<K>;
}

// Export the live object reference directly for zero-overhead caching
export function configGetAll(): { [K in ConfigKey]: ConfigValue<K> } {
  return localConfig;
}
