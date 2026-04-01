import { clampMaxVolume, clampMinVolume, clampStep, formatVolumeLabel } from "../shared/constants.js";
import { getSettings, getSiteProfiles, removeSiteProfile, resetSiteProfiles, setSettings } from "../shared/storage.js";
function getRequiredElement(selector, parent = document) {
    const element = parent.querySelector(selector);
    if (!element) {
        throw new Error(`Missing required element: ${selector}`);
    }
    return element;
}
const elements = {
    autoApplyToggle: getRequiredElement(".js-auto-apply-toggle"),
    audibleTabsToggle: getRequiredElement(".js-audible-tabs-toggle"),
    emptySites: getRequiredElement(".js-empty-sites"),
    maxVolume: getRequiredElement(".js-max-volume"),
    minVolume: getRequiredElement(".js-min-volume"),
    stepAbove100: getRequiredElement(".js-step-above-100"),
    stepBelow100: getRequiredElement(".js-step-below-100"),
    persistToggle: getRequiredElement(".js-persist-toggle"),
    resetSites: getRequiredElement(".js-reset-sites"),
    saveState: getRequiredElement(".js-save-state"),
    savedSites: getRequiredElement(".js-saved-sites"),
    settingsForm: getRequiredElement(".js-settings-form"),
    template: getRequiredElement("#savedSiteTemplate")
};
let saveStateTimerId = null;
function setSaveState(message) {
    elements.saveState.textContent = message;
}
function scheduleSaveStateReset() {
    if (saveStateTimerId !== null) {
        window.clearTimeout(saveStateTimerId);
    }
    saveStateTimerId = window.setTimeout(() => {
        setSaveState("");
        saveStateTimerId = null;
    }, 1400);
}
function formatProfileMeta(profile) {
    return `${formatVolumeLabel(profile.volume)} • ${profile.muted ? "muted" : profile.mono ? "mono" : "stereo"}`;
}
function readSettingsForm() {
    return {
        minVolume: clampMinVolume(elements.minVolume.value),
        maxVolume: clampMaxVolume(elements.maxVolume.value),
        stepBelow100: clampStep(elements.stepBelow100.value),
        stepAbove100: clampStep(elements.stepAbove100.value),
        persistPerSite: elements.persistToggle.checked,
        autoApplySavedLevels: elements.autoApplyToggle.checked,
        showAudibleTabs: elements.audibleTabsToggle.checked
    };
}
async function renderProfiles() {
    const profiles = await getSiteProfiles();
    const entries = Object.entries(profiles).sort(([left], [right]) => left.localeCompare(right));
    elements.savedSites.textContent = "";
    elements.emptySites.classList.toggle("is-hidden", entries.length > 0);
    entries.forEach(([siteKey, profile]) => {
        const fragment = elements.template.content.cloneNode(true);
        const title = getRequiredElement(".saved-site__title", fragment);
        const meta = getRequiredElement(".saved-site__meta", fragment);
        const removeButton = getRequiredElement(".saved-site__remove", fragment);
        title.textContent = siteKey;
        meta.textContent = formatProfileMeta(profile);
        removeButton.dataset.siteKey = siteKey;
        elements.savedSites.appendChild(fragment);
    });
}
async function loadSettings() {
    const settings = await getSettings();
    elements.minVolume.value = String(settings.minVolume);
    elements.maxVolume.value = String(settings.maxVolume);
    elements.stepBelow100.value = String(settings.stepBelow100);
    elements.stepAbove100.value = String(settings.stepAbove100);
    elements.persistToggle.checked = settings.persistPerSite;
    elements.autoApplyToggle.checked = settings.autoApplySavedLevels;
    elements.audibleTabsToggle.checked = settings.showAudibleTabs;
}
async function saveSettings(event) {
    event.preventDefault();
    await setSettings(readSettingsForm());
    await loadSettings();
    setSaveState("Saved");
    scheduleSaveStateReset();
}
async function handleSavedSitesClick(event) {
    if (!(event.target instanceof Element)) {
        return;
    }
    const button = event.target.closest(".saved-site__remove");
    const siteKey = button?.dataset.siteKey;
    if (!siteKey) {
        return;
    }
    await removeSiteProfile(siteKey);
    await renderProfiles();
}
function handleOptionsError(error) {
    console.error("Options page failed to load", error);
    setSaveState("Unable to load settings");
}
elements.settingsForm.addEventListener("submit", (event) => {
    void saveSettings(event).catch(handleOptionsError);
});
elements.savedSites.addEventListener("click", (event) => {
    void handleSavedSitesClick(event).catch(handleOptionsError);
});
elements.resetSites.addEventListener("click", () => {
    void resetSiteProfiles()
        .then(renderProfiles)
        .catch(handleOptionsError);
});
void Promise.all([loadSettings(), renderProfiles()]).catch(handleOptionsError);
