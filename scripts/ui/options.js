import { clampMaxVolume, clampMinVolume, clampStep, formatVolumeLabel } from "../shared/constants.js";
import {
  getSettings,
  getSiteProfiles,
  removeSiteProfile,
  resetSiteProfiles,
  setSettings
} from "../shared/storage.js";

const elements = {
  autoApplyToggle: document.querySelector(".js-auto-apply-toggle"),
  audibleTabsToggle: document.querySelector(".js-audible-tabs-toggle"),
  emptySites: document.querySelector(".js-empty-sites"),
  maxVolume: document.querySelector(".js-max-volume"),
  minVolume: document.querySelector(".js-min-volume"),
  stepAbove100: document.querySelector(".js-step-above-100"),
  stepBelow100: document.querySelector(".js-step-below-100"),
  persistToggle: document.querySelector(".js-persist-toggle"),
  resetSites: document.querySelector(".js-reset-sites"),
  saveState: document.querySelector(".js-save-state"),
  savedSites: document.querySelector(".js-saved-sites"),
  settingsForm: document.querySelector(".js-settings-form"),
  template: document.querySelector("#savedSiteTemplate")
};

async function renderProfiles() {
  const profiles = await getSiteProfiles();
  const entries = Object.entries(profiles).sort(([left], [right]) => left.localeCompare(right));

  elements.savedSites.textContent = "";
  elements.emptySites.classList.toggle("is-hidden", entries.length > 0);

  entries.forEach(([siteKey, profile]) => {
    const fragment = elements.template.content.cloneNode(true);
    const title = fragment.querySelector(".saved-site__title");
    const meta = fragment.querySelector(".saved-site__meta");
    const removeButton = fragment.querySelector(".saved-site__remove");

    title.textContent = siteKey;
    meta.textContent = `${formatVolumeLabel(profile.volume)} • ${profile.muted ? "muted" : profile.mono ? "mono" : "stereo"}`;
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

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const nextSettings = {
    minVolume: clampMinVolume(elements.minVolume.value),
    maxVolume: clampMaxVolume(elements.maxVolume.value),
    stepBelow100: clampStep(elements.stepBelow100.value),
    stepAbove100: clampStep(elements.stepAbove100.value),
    persistPerSite: elements.persistToggle.checked,
    autoApplySavedLevels: elements.autoApplyToggle.checked,
    showAudibleTabs: elements.audibleTabsToggle.checked
  };

  await setSettings(nextSettings);
  await loadSettings();
  elements.saveState.textContent = "Saved";
  window.setTimeout(() => {
    elements.saveState.textContent = "";
  }, 1400);
});

elements.savedSites.addEventListener("click", async (event) => {
  const button = event.target.closest(".saved-site__remove");

  if (!button) {
    return;
  }

  await removeSiteProfile(button.dataset.siteKey);
  await renderProfiles();
});

elements.resetSites.addEventListener("click", async () => {
  await resetSiteProfiles();
  await renderProfiles();
});

Promise.all([loadSettings(), renderProfiles()]).catch((error) => {
  console.error("Options page failed to load", error);
  elements.saveState.textContent = "Unable to load settings";
});