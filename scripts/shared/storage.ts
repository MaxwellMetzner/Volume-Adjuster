import {
  DEFAULT_AUDIO_STATE,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  getSiteKey,
  normalizeAudioState,
  normalizeSettings
} from "./constants.js";
import type { AudioState, Settings, SiteProfiles } from "./types.js";

type StorageShape = {
  [STORAGE_KEYS.SETTINGS]: Settings;
  [STORAGE_KEYS.SITE_PROFILES]: SiteProfiles;
};

async function readLocal<Key extends keyof StorageShape>(
  key: Key,
  fallbackValue: StorageShape[Key]
): Promise<StorageShape[Key]> {
  const storedValue = await chrome.storage.local.get({ [key]: fallbackValue });
  return storedValue[key] as StorageShape[Key];
}

async function writeLocal<Key extends keyof StorageShape>(
  key: Key,
  value: StorageShape[Key]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings(): Promise<Settings> {
  const storedSettings = await readLocal(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  return normalizeSettings(storedSettings);
}

export async function setSettings(nextSettings: Partial<Settings>): Promise<Settings> {
  const mergedSettings = normalizeSettings({ ...(await getSettings()), ...nextSettings });
  await writeLocal(STORAGE_KEYS.SETTINGS, mergedSettings);
  return mergedSettings;
}

export async function getSiteProfiles(): Promise<SiteProfiles> {
  return readLocal(STORAGE_KEYS.SITE_PROFILES, {} as SiteProfiles);
}

export async function getSiteProfile(
  urlOrKey: string | null | undefined,
  settings: Readonly<Settings> = DEFAULT_SETTINGS
): Promise<AudioState | null> {
  const siteKey = urlOrKey?.includes("://") ? getSiteKey(urlOrKey) : urlOrKey ?? null;

  if (!siteKey) {
    return null;
  }

  const profiles = await getSiteProfiles();
  const candidate = profiles[siteKey];

  return candidate
    ? normalizeAudioState(
        { ...candidate, minVolume: settings.minVolume },
        settings.maxVolume
      )
    : null;
}

export async function saveSiteProfile(
  urlOrKey: string | null | undefined,
  profile: Readonly<AudioState>,
  settings: Readonly<Settings> = DEFAULT_SETTINGS
): Promise<AudioState | null> {
  const siteKey = urlOrKey?.includes("://") ? getSiteKey(urlOrKey) : urlOrKey ?? null;

  if (!siteKey) {
    return null;
  }

  const profiles = await getSiteProfiles();
  const normalizedProfile = normalizeAudioState(
    { ...profile, minVolume: settings.minVolume },
    settings.maxVolume
  );

  if (
    normalizedProfile.volume === DEFAULT_AUDIO_STATE.volume &&
    normalizedProfile.mono === DEFAULT_AUDIO_STATE.mono &&
    normalizedProfile.muted === DEFAULT_AUDIO_STATE.muted
  ) {
    delete profiles[siteKey];
  } else {
    profiles[siteKey] = normalizedProfile;
  }

  await writeLocal(STORAGE_KEYS.SITE_PROFILES, profiles);
  return normalizedProfile;
}

export async function removeSiteProfile(siteKey: string): Promise<void> {
  const profiles = await getSiteProfiles();
  delete profiles[siteKey];
  await writeLocal(STORAGE_KEYS.SITE_PROFILES, profiles);
}

export async function resetSiteProfiles(): Promise<void> {
  await writeLocal(STORAGE_KEYS.SITE_PROFILES, {} as SiteProfiles);
}