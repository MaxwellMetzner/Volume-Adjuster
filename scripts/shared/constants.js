export const OFFSCREEN_DOCUMENT_PATH = "pages/offscreen.html";

export const MESSAGE_TYPES = Object.freeze({
  AUDIO_APPLY: "audio:apply",
  AUDIO_GET_STATE: "audio:get-state",
  AUDIO_RELEASE: "audio:release",
  CONTENT_NAVIGATED: "content:navigated",
  OPTIONS_GET_DATA: "options:get-data",
  OPTIONS_REMOVE_PROFILE: "options:remove-profile",
  OPTIONS_RESET_PROFILES: "options:reset-profiles",
  POPUP_APPLY_AUDIO: "popup:apply-audio",
  POPUP_FOCUS_TAB: "popup:focus-tab",
  POPUP_GET_STATE: "popup:get-state"
});

export const MESSAGE_TARGETS = Object.freeze({
  OFFSCREEN: "offscreen"
});

export const STORAGE_KEYS = Object.freeze({
  SETTINGS: "settings",
  SITE_PROFILES: "siteProfiles"
});

export const DEFAULT_SETTINGS = Object.freeze({
  minVolume: 0,
  maxVolume: 300,
  stepBelow100: 5,
  stepAbove100: 10,
  persistPerSite: true,
  autoApplySavedLevels: true,
  showAudibleTabs: true
});

export const DEFAULT_AUDIO_STATE = Object.freeze({
  volume: 100,
  mono: false,
  muted: false
});

export const SETTINGS_LIMITS = Object.freeze({
  minStep: 1,
  maxStep: 50,
  minVolume: 0,
  maxBelowNormalVolume: 100,
  normalVolume: 100,
  minMaxVolume: 100
});

export function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

export function clampStep(step) {
  return Math.round(
    clampNumber(
      step,
      SETTINGS_LIMITS.minStep,
      SETTINGS_LIMITS.maxStep,
      DEFAULT_SETTINGS.stepBelow100
    )
  );
}

export function clampMinVolume(minVolume) {
  return Math.round(
    clampNumber(
      minVolume,
      SETTINGS_LIMITS.minVolume,
      SETTINGS_LIMITS.maxBelowNormalVolume,
      DEFAULT_SETTINGS.minVolume
    )
  );
}

export function clampMaxVolume(maxVolume) {
  const numericValue = Number(maxVolume);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SETTINGS.maxVolume;
  }

  return Math.max(SETTINGS_LIMITS.minMaxVolume, Math.round(numericValue));
}

export function clampVolume(
  volume,
  maxVolume = DEFAULT_SETTINGS.maxVolume,
  minVolume = DEFAULT_SETTINGS.minVolume
) {
  return Math.round(
    clampNumber(volume, clampMinVolume(minVolume), clampMaxVolume(maxVolume), DEFAULT_AUDIO_STATE.volume)
  );
}

export function getStepForVolume(volume, settings = DEFAULT_SETTINGS) {
  return volume > SETTINGS_LIMITS.normalVolume ? settings.stepAbove100 : settings.stepBelow100;
}

export function snapVolumeToStep(volume, settings = DEFAULT_SETTINGS) {
  const minVolume = clampMinVolume(settings.minVolume);
  const maxVolume = clampMaxVolume(settings.maxVolume);
  const normalizedVolume = clampVolume(volume, maxVolume, minVolume);

  if (normalizedVolume === SETTINGS_LIMITS.normalVolume) {
    return SETTINGS_LIMITS.normalVolume;
  }

  if (normalizedVolume < SETTINGS_LIMITS.normalVolume) {
    const distance = SETTINGS_LIMITS.normalVolume - normalizedVolume;
    const steppedValue =
      SETTINGS_LIMITS.normalVolume - Math.round(distance / settings.stepBelow100) * settings.stepBelow100;
    return clampVolume(steppedValue, SETTINGS_LIMITS.normalVolume, minVolume);
  }

  const distance = normalizedVolume - SETTINGS_LIMITS.normalVolume;
  const steppedValue =
    SETTINGS_LIMITS.normalVolume + Math.round(distance / settings.stepAbove100) * settings.stepAbove100;

  return clampVolume(steppedValue, maxVolume, SETTINGS_LIMITS.normalVolume);
}

export function normalizeSettings(candidate = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    minVolume: clampMinVolume(candidate.minVolume ?? DEFAULT_SETTINGS.minVolume),
    maxVolume: clampMaxVolume(candidate.maxVolume ?? DEFAULT_SETTINGS.maxVolume),
    stepBelow100: clampStep(candidate.stepBelow100 ?? DEFAULT_SETTINGS.stepBelow100),
    stepAbove100: clampStep(candidate.stepAbove100 ?? DEFAULT_SETTINGS.stepAbove100),
    persistPerSite: Boolean(candidate.persistPerSite ?? DEFAULT_SETTINGS.persistPerSite),
    autoApplySavedLevels: Boolean(
      candidate.autoApplySavedLevels ?? DEFAULT_SETTINGS.autoApplySavedLevels
    ),
    showAudibleTabs: Boolean(candidate.showAudibleTabs ?? DEFAULT_SETTINGS.showAudibleTabs)
  };
}

export function normalizeAudioState(candidate = {}, maxVolume = DEFAULT_SETTINGS.maxVolume) {
  const minVolume = DEFAULT_SETTINGS.minVolume;
  return {
    volume: clampVolume(candidate.volume ?? DEFAULT_AUDIO_STATE.volume, maxVolume, candidate.minVolume ?? minVolume),
    mono: Boolean(candidate.mono ?? DEFAULT_AUDIO_STATE.mono),
    muted: Boolean(candidate.muted ?? DEFAULT_AUDIO_STATE.muted)
  };
}

export function isSupportedTabUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

export function getSiteKey(url) {
  if (!isSupportedTabUrl(url)) {
    return null;
  }

  const parsedUrl = new URL(url);
  return parsedUrl.hostname.replace(/^www\./, "").toLowerCase();
}

export function getSiteLabel(url) {
  return getSiteKey(url) ?? "Unsupported page";
}

export function formatVolumeLabel(volume) {
  return `${Math.round(volume)}%`;
}