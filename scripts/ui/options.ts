import {
  clampMaxVolume,
  clampMinVolume,
  clampStep,
  formatVolumeLabel
} from "../shared/constants.js";
import {
  getSettings,
  getSiteProfiles,
  removeSiteProfile,
  resetSiteProfiles,
  setSettings
} from "../shared/storage.js";
import type { AudioState, Settings } from "../shared/types.js";

interface OptionsElements {
  autoApplyToggle: HTMLInputElement;
  audibleTabsToggle: HTMLInputElement;
  emptySites: HTMLParagraphElement;
  maxVolume: HTMLInputElement;
  minVolume: HTMLInputElement;
  stepAbove100: HTMLInputElement;
  stepBelow100: HTMLInputElement;
  persistToggle: HTMLInputElement;
  resetSites: HTMLButtonElement;
  saveState: HTMLSpanElement;
  savedSites: HTMLDivElement;
  settingsForm: HTMLFormElement;
  template: HTMLTemplateElement;
}

function getRequiredElement<T extends Element>(selector: string, parent: ParentNode = document): T {
  const element = parent.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

const elements: OptionsElements = {
  autoApplyToggle: getRequiredElement<HTMLInputElement>(".js-auto-apply-toggle"),
  audibleTabsToggle: getRequiredElement<HTMLInputElement>(".js-audible-tabs-toggle"),
  emptySites: getRequiredElement<HTMLParagraphElement>(".js-empty-sites"),
  maxVolume: getRequiredElement<HTMLInputElement>(".js-max-volume"),
  minVolume: getRequiredElement<HTMLInputElement>(".js-min-volume"),
  stepAbove100: getRequiredElement<HTMLInputElement>(".js-step-above-100"),
  stepBelow100: getRequiredElement<HTMLInputElement>(".js-step-below-100"),
  persistToggle: getRequiredElement<HTMLInputElement>(".js-persist-toggle"),
  resetSites: getRequiredElement<HTMLButtonElement>(".js-reset-sites"),
  saveState: getRequiredElement<HTMLSpanElement>(".js-save-state"),
  savedSites: getRequiredElement<HTMLDivElement>(".js-saved-sites"),
  settingsForm: getRequiredElement<HTMLFormElement>(".js-settings-form"),
  template: getRequiredElement<HTMLTemplateElement>("#savedSiteTemplate")
};

let saveStateTimerId: number | null = null;

function setSaveState(message: string): void {
  elements.saveState.textContent = message;
}

function scheduleSaveStateReset(): void {
  if (saveStateTimerId !== null) {
    window.clearTimeout(saveStateTimerId);
  }

  saveStateTimerId = window.setTimeout(() => {
    setSaveState("");
    saveStateTimerId = null;
  }, 1400);
}

function formatProfileMeta(profile: Readonly<AudioState>): string {
  return `${formatVolumeLabel(profile.volume)} • ${profile.muted ? "muted" : profile.mono ? "mono" : "stereo"}`;
}

function readSettingsForm(): Partial<Settings> {
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

async function renderProfiles(): Promise<void> {
  const profiles = await getSiteProfiles();
  const entries = Object.entries(profiles).sort(([left], [right]) => left.localeCompare(right));

  elements.savedSites.textContent = "";
  elements.emptySites.classList.toggle("is-hidden", entries.length > 0);

  entries.forEach(([siteKey, profile]) => {
    const fragment = elements.template.content.cloneNode(true) as DocumentFragment;
    const title = getRequiredElement<HTMLHeadingElement>(".saved-site__title", fragment);
    const meta = getRequiredElement<HTMLParagraphElement>(".saved-site__meta", fragment);
    const removeButton = getRequiredElement<HTMLButtonElement>(".saved-site__remove", fragment);

    title.textContent = siteKey;
    meta.textContent = formatProfileMeta(profile);
    removeButton.dataset.siteKey = siteKey;

    elements.savedSites.appendChild(fragment);
  });
}

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  elements.minVolume.value = String(settings.minVolume);
  elements.maxVolume.value = String(settings.maxVolume);
  elements.stepBelow100.value = String(settings.stepBelow100);
  elements.stepAbove100.value = String(settings.stepAbove100);
  elements.persistToggle.checked = settings.persistPerSite;
  elements.autoApplyToggle.checked = settings.autoApplySavedLevels;
  elements.audibleTabsToggle.checked = settings.showAudibleTabs;
}

async function saveSettings(event: SubmitEvent): Promise<void> {
  event.preventDefault();

  await setSettings(readSettingsForm());
  await loadSettings();
  setSaveState("Saved");
  scheduleSaveStateReset();
}

async function handleSavedSitesClick(event: MouseEvent): Promise<void> {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest(".saved-site__remove") as HTMLButtonElement | null;
  const siteKey = button?.dataset.siteKey;

  if (!siteKey) {
    return;
  }

  await removeSiteProfile(siteKey);
  await renderProfiles();
}

function handleOptionsError(error: unknown): void {
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