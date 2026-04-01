import {
  DEFAULT_AUDIO_STATE,
  MESSAGE_TYPES,
  SETTINGS_LIMITS,
  clampVolume,
  formatVolumeLabel,
  getSiteLabel,
  snapVolumeToStep
} from "../shared/constants.js";
import type {
  AudioState,
  AudibleTabSummary,
  PopupApplyAudioMessage,
  PopupState,
  RuntimeErrorResponse,
  RuntimeRequestMessage,
  Settings
} from "../shared/types.js";
import { isRuntimeErrorResponse } from "../shared/types.js";

const SLIDER_SCALE = 1000;
const TICK_THRESHOLD_RATIO = 0.075;

interface PopupElements {
  anchorMarker: HTMLDivElement;
  attentionNote: HTMLParagraphElement;
  audibleCount: HTMLSpanElement;
  audibleList: HTMLDivElement;
  emptyState: HTMLParagraphElement;
  monoButton: HTMLButtonElement;
  muteButton: HTMLButtonElement;
  openSettings: HTMLButtonElement;
  siteLabel: HTMLParagraphElement;
  tabsPanel: HTMLElement;
  template: HTMLTemplateElement;
  tickStrip: HTMLDivElement;
  unsupportedNote: HTMLParagraphElement;
  volumeRange: HTMLInputElement;
  volumeValue: HTMLSpanElement;
}

interface PopupUiState {
  activeTab: PopupState["activeTab"];
  activeTabSupported: boolean;
  currentState: AudioState;
  initializingCapture: boolean;
  settings: Settings | null;
}

function getRequiredElement<T extends Element>(selector: string, parent: ParentNode = document): T {
  const element = parent.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

async function sendMessage<TResponse>(message: RuntimeRequestMessage): Promise<TResponse> {
  const response = (await chrome.runtime.sendMessage(message)) as TResponse | RuntimeErrorResponse;

  if (isRuntimeErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response;
}

const elements: PopupElements = {
  anchorMarker: getRequiredElement<HTMLDivElement>(".js-anchor-marker"),
  attentionNote: getRequiredElement<HTMLParagraphElement>(".js-attention-note"),
  audibleCount: getRequiredElement<HTMLSpanElement>(".js-audible-count"),
  audibleList: getRequiredElement<HTMLDivElement>(".js-audible-list"),
  emptyState: getRequiredElement<HTMLParagraphElement>(".js-empty-state"),
  monoButton: getRequiredElement<HTMLButtonElement>(".js-mono-button"),
  muteButton: getRequiredElement<HTMLButtonElement>(".js-mute-button"),
  openSettings: getRequiredElement<HTMLButtonElement>(".js-open-settings"),
  siteLabel: getRequiredElement<HTMLParagraphElement>(".js-site-label"),
  tabsPanel: getRequiredElement<HTMLElement>(".js-tabs-panel"),
  template: getRequiredElement<HTMLTemplateElement>("#audibleTabTemplate"),
  tickStrip: getRequiredElement<HTMLDivElement>(".js-tick-strip"),
  unsupportedNote: getRequiredElement<HTMLParagraphElement>(".js-unsupported-note"),
  volumeRange: getRequiredElement<HTMLInputElement>(".js-volume-range"),
  volumeValue: getRequiredElement<HTMLSpanElement>(".js-volume-value")
};

const state: PopupUiState = {
  activeTab: null,
  activeTabSupported: false,
  currentState: { ...DEFAULT_AUDIO_STATE },
  initializingCapture: false,
  settings: null
};

function handlePopupError(error: unknown): void {
  console.error("Popup interaction failed", error);
}

function isDefaultAudioState(audioState: Readonly<AudioState>): boolean {
  return (
    audioState.volume === DEFAULT_AUDIO_STATE.volume &&
    audioState.mono === DEFAULT_AUDIO_STATE.mono &&
    audioState.muted === DEFAULT_AUDIO_STATE.muted
  );
}

function setControlsDisabled(disabled: boolean): void {
  elements.volumeRange.disabled = disabled;
  elements.monoButton.disabled = disabled;
  elements.muteButton.disabled = disabled;
}

function getAnchorRatio(settings: Readonly<Settings>): number {
  if (
    settings.minVolume >= SETTINGS_LIMITS.normalVolume &&
    settings.maxVolume <= SETTINGS_LIMITS.normalVolume
  ) {
    return 0.5;
  }

  if (settings.minVolume >= SETTINGS_LIMITS.normalVolume) {
    return 0;
  }

  if (settings.maxVolume <= SETTINGS_LIMITS.normalVolume) {
    return 1;
  }

  return 0.5;
}

function volumeToSliderValue(volume: number, settings: Readonly<Settings>): number {
  const anchorRatio = getAnchorRatio(settings);
  const anchorValue = Math.round(anchorRatio * SLIDER_SCALE);

  if (volume <= SETTINGS_LIMITS.normalVolume) {
    if (settings.minVolume >= SETTINGS_LIMITS.normalVolume) {
      return 0;
    }

    const lowerSpan = SETTINGS_LIMITS.normalVolume - settings.minVolume;
    const lowerRatio = (volume - settings.minVolume) / lowerSpan;
    return Math.round(anchorValue * lowerRatio);
  }

  if (settings.maxVolume <= SETTINGS_LIMITS.normalVolume) {
    return SLIDER_SCALE;
  }

  const upperSpan = settings.maxVolume - SETTINGS_LIMITS.normalVolume;
  const upperRatio = (volume - SETTINGS_LIMITS.normalVolume) / upperSpan;
  return Math.round(anchorValue + (SLIDER_SCALE - anchorValue) * upperRatio);
}

function sliderValueToVolume(sliderValue: number, settings: Readonly<Settings>): number {
  const anchorRatio = getAnchorRatio(settings);
  const anchorValue = anchorRatio * SLIDER_SCALE;

  if (sliderValue <= anchorValue) {
    if (settings.minVolume >= SETTINGS_LIMITS.normalVolume || anchorValue === 0) {
      return SETTINGS_LIMITS.normalVolume;
    }

    const lowerRatio = sliderValue / anchorValue;
    return settings.minVolume + lowerRatio * (SETTINGS_LIMITS.normalVolume - settings.minVolume);
  }

  if (settings.maxVolume <= SETTINGS_LIMITS.normalVolume || anchorValue === SLIDER_SCALE) {
    return SETTINGS_LIMITS.normalVolume;
  }

  const upperRatio = (sliderValue - anchorValue) / (SLIDER_SCALE - anchorValue);
  return SETTINGS_LIMITS.normalVolume + upperRatio * (settings.maxVolume - SETTINGS_LIMITS.normalVolume);
}

function appendTicks(
  startVolume: number,
  endVolume: number,
  step: number,
  settings: Readonly<Settings>
): void {
  if (startVolume === endVolume || step <= 0) {
    return;
  }

  const startPosition = volumeToSliderValue(startVolume, settings);
  const endPosition = volumeToSliderValue(endVolume, settings);
  const segmentWidth = Math.abs(endPosition - startPosition) / SLIDER_SCALE;
  const segmentSpan = Math.abs(endVolume - startVolume);

  if (!segmentSpan) {
    return;
  }

  const stepRatio = (step / segmentSpan) * segmentWidth;

  if (stepRatio < TICK_THRESHOLD_RATIO) {
    return;
  }

  const direction = startVolume < endVolume ? 1 : -1;

  for (
    let volume = startVolume + step * direction;
    direction > 0 ? volume < endVolume : volume > endVolume;
    volume += step * direction
  ) {
    const tick = document.createElement("span");
    tick.className = "tick-strip__tick";
    tick.style.left = `${(volumeToSliderValue(volume, settings) / SLIDER_SCALE) * 100}%`;
    elements.tickStrip.appendChild(tick);
  }
}

function renderTicks(): void {
  if (!state.settings) {
    return;
  }

  elements.tickStrip.textContent = "";
  elements.anchorMarker.style.left = `${getAnchorRatio(state.settings) * 100}%`;

  appendTicks(
    state.settings.minVolume,
    SETTINGS_LIMITS.normalVolume,
    state.settings.stepBelow100,
    state.settings
  );
  appendTicks(
    SETTINGS_LIMITS.normalVolume,
    state.settings.maxVolume,
    state.settings.stepAbove100,
    state.settings
  );
}

function renderState(): void {
  if (!state.settings) {
    return;
  }

  elements.volumeValue.textContent = formatVolumeLabel(state.currentState.volume);
  elements.volumeRange.value = String(volumeToSliderValue(state.currentState.volume, state.settings));
  elements.monoButton.classList.toggle("is-active", state.currentState.mono);
  elements.monoButton.setAttribute("aria-pressed", String(state.currentState.mono));
  elements.muteButton.classList.toggle("is-active", state.currentState.muted);
  elements.muteButton.setAttribute("aria-pressed", String(state.currentState.muted));
}

function renderAudibleTabs(tabs: AudibleTabSummary[]): void {
  elements.audibleList.textContent = "";
  elements.audibleCount.textContent = String(tabs.length);
  elements.emptyState.classList.toggle("is-hidden", tabs.length > 0);

  tabs.forEach((tab) => {
    const fragment = elements.template.content.cloneNode(true) as DocumentFragment;
    const button = getRequiredElement<HTMLButtonElement>(".tab-chip", fragment);
    const icon = getRequiredElement<HTMLImageElement>(".tab-chip__icon", fragment);
    const site = getRequiredElement<HTMLSpanElement>(".tab-chip__site", fragment);
    const status = getRequiredElement<HTMLSpanElement>(".tab-chip__status", fragment);
    const label = tab.title || getSiteLabel(tab.url);
    const badges: string[] = [];

    if (tab.audioState?.mono) {
      badges.push("🔊 Mono");
    }

    if (tab.audioState?.muted) {
      badges.push("🔇 Muted");
    }

    button.dataset.tabId = String(tab.id);
    button.setAttribute("aria-label", `Switch to ${label}`);
    button.classList.toggle("is-active", Boolean(state.activeTab && tab.id === state.activeTab.id));
    site.textContent = label;
    site.title = label;
    status.textContent = badges.join("  ");
    status.classList.toggle("is-hidden", badges.length === 0);

    if (tab.favIconUrl) {
      icon.src = tab.favIconUrl;
    } else {
      icon.removeAttribute("src");
    }

    elements.audibleList.appendChild(fragment);
  });
}

function renderOverview(): void {
  const activeUrl = state.activeTab?.url ?? "";
  elements.siteLabel.textContent = getSiteLabel(activeUrl);
  elements.unsupportedNote.classList.toggle("is-hidden", state.activeTabSupported);

  if (!state.activeTabSupported) {
    setControlsDisabled(true);
    renderTicks();
    renderState();
    return;
  }

  setControlsDisabled(false);
  renderTicks();
  renderState();
}

async function applyState(nextState: Readonly<AudioState>): Promise<void> {
  if (!state.activeTab?.id || !state.activeTabSupported || !state.settings) {
    return;
  }

  const normalizedState: AudioState = {
    volume: snapVolumeToStep(
      clampVolume(nextState.volume, state.settings.maxVolume, state.settings.minVolume),
      state.settings
    ),
    mono: Boolean(nextState.mono),
    muted: Boolean(nextState.muted)
  };

  state.currentState = normalizedState;
  renderState();

  const message: PopupApplyAudioMessage = {
    type: MESSAGE_TYPES.POPUP_APPLY_AUDIO,
    tabId: state.activeTab.id,
    url: state.activeTab.url,
    ...normalizedState
  };
  const response = await sendMessage<AudioState>(message);

  state.currentState = response;
  renderState();
}

async function initializeCaptureFromPopup(): Promise<void> {
  if (
    state.initializingCapture ||
    !state.activeTab?.id ||
    !state.activeTabSupported ||
    isDefaultAudioState(state.currentState)
  ) {
    return;
  }

  state.initializingCapture = true;

  try {
    const mediaStreamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: state.activeTab.id
    });
    const response = await sendMessage<AudioState>({
      type: MESSAGE_TYPES.POPUP_APPLY_AUDIO,
      tabId: state.activeTab.id,
      url: state.activeTab.url,
      mediaStreamId,
      ...state.currentState
    });

    state.currentState = response;
    renderState();
  } finally {
    state.initializingCapture = false;
  }
}

async function loadPopup(): Promise<void> {
  const response = await sendMessage<PopupState>({ type: MESSAGE_TYPES.POPUP_GET_STATE });

  state.activeTab = response.activeTab;
  state.activeTabSupported = response.activeTabSupported;
  state.currentState = response.currentState;
  state.settings = response.settings;

  elements.volumeRange.min = "0";
  elements.volumeRange.max = String(SLIDER_SCALE);
  elements.volumeRange.step = "1";
  elements.attentionNote.classList.toggle("is-hidden", !response.needsTabCaptureInit);
  elements.tabsPanel.classList.toggle("is-hidden", !response.settings.showAudibleTabs);

  renderOverview();
  renderAudibleTabs(response.audibleTabs);

  if (response.needsTabCaptureInit) {
    await initializeCaptureFromPopup();
  }
}

function bindEvents(): void {
  elements.openSettings.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage().catch(handlePopupError);
  });

  elements.volumeRange.addEventListener("input", (event) => {
    if (!(event.currentTarget instanceof HTMLInputElement) || !state.settings) {
      return;
    }

    void applyState({
      ...state.currentState,
      volume: snapVolumeToStep(
        sliderValueToVolume(Number(event.currentTarget.value), state.settings),
        state.settings
      )
    }).catch(handlePopupError);
  });

  elements.monoButton.addEventListener("click", () => {
    void applyState({
      ...state.currentState,
      mono: !state.currentState.mono
    }).catch(handlePopupError);
  });

  elements.muteButton.addEventListener("click", () => {
    void applyState({
      ...state.currentState,
      muted: !state.currentState.muted
    }).catch(handlePopupError);
  });

  elements.audibleList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest(".tab-chip") as HTMLButtonElement | null;
    const tabId = button?.dataset.tabId;

    if (!tabId) {
      return;
    }

    void sendMessage<void>({
      type: MESSAGE_TYPES.POPUP_FOCUS_TAB,
      tabId: Number(tabId)
    })
      .then(() => {
        window.close();
      })
      .catch(handlePopupError);
  });
}

bindEvents();
void loadPopup().catch((error: unknown) => {
  console.error("Popup failed to load", error);
  elements.siteLabel.textContent = "Unavailable";
  setControlsDisabled(true);
});