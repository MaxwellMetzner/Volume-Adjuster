import { DEFAULT_AUDIO_STATE, DEFAULT_SETTINGS, STORAGE_KEYS, getSiteKey, normalizeAudioState, normalizeSettings } from "./constants.js";
async function readLocal(key, fallbackValue) {
    const storedValue = await chrome.storage.local.get({ [key]: fallbackValue });
    return storedValue[key];
}
async function writeLocal(key, value) {
    await chrome.storage.local.set({ [key]: value });
}
export async function getSettings() {
    const storedSettings = await readLocal(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    return normalizeSettings(storedSettings);
}
export async function setSettings(nextSettings) {
    const mergedSettings = normalizeSettings({ ...(await getSettings()), ...nextSettings });
    await writeLocal(STORAGE_KEYS.SETTINGS, mergedSettings);
    return mergedSettings;
}
export async function getSiteProfiles() {
    return readLocal(STORAGE_KEYS.SITE_PROFILES, {});
}
export async function getSiteProfile(urlOrKey, settings = DEFAULT_SETTINGS) {
    const siteKey = urlOrKey?.includes("://") ? getSiteKey(urlOrKey) : urlOrKey ?? null;
    if (!siteKey) {
        return null;
    }
    const profiles = await getSiteProfiles();
    const candidate = profiles[siteKey];
    return candidate
        ? normalizeAudioState({ ...candidate, minVolume: settings.minVolume }, settings.maxVolume)
        : null;
}
export async function saveSiteProfile(urlOrKey, profile, settings = DEFAULT_SETTINGS) {
    const siteKey = urlOrKey?.includes("://") ? getSiteKey(urlOrKey) : urlOrKey ?? null;
    if (!siteKey) {
        return null;
    }
    const profiles = await getSiteProfiles();
    const normalizedProfile = normalizeAudioState({ ...profile, minVolume: settings.minVolume }, settings.maxVolume);
    if (normalizedProfile.volume === DEFAULT_AUDIO_STATE.volume &&
        normalizedProfile.mono === DEFAULT_AUDIO_STATE.mono &&
        normalizedProfile.muted === DEFAULT_AUDIO_STATE.muted) {
        delete profiles[siteKey];
    }
    else {
        profiles[siteKey] = normalizedProfile;
    }
    await writeLocal(STORAGE_KEYS.SITE_PROFILES, profiles);
    return normalizedProfile;
}
export async function removeSiteProfile(siteKey) {
    const profiles = await getSiteProfiles();
    delete profiles[siteKey];
    await writeLocal(STORAGE_KEYS.SITE_PROFILES, profiles);
}
export async function resetSiteProfiles() {
    await writeLocal(STORAGE_KEYS.SITE_PROFILES, {});
}
