import {
  DEFAULT_AUDIO_STATE,
  MESSAGE_TYPES,
  SETTINGS_LIMITS,
  clampVolume,
  formatVolumeLabel,
  getSiteLabel,
  snapVolumeToStep
} from "../shared/constants.js";

const SLIDER_SCALE = 1000;
const TICK_THRESHOLD_RATIO = 0.075;

const elements = {
  anchorMarker: document.querySelector(".js-anchor-marker"),
  attentionNote: document.querySelector(".js-attention-note"),
  audibleCount: document.querySelector(".js-audible-count"),
  audibleList: document.querySelector(".js-audible-list"),
  emptyState: document.querySelector(".js-empty-state"),
  monoButton: document.querySelector(".js-mono-button"),
  muteButton: document.querySelector(".js-mute-button"),
  openSettings: document.querySelector(".js-open-settings"),
  siteLabel: document.querySelector(".js-site-label"),
  tabsPanel: document.querySelector(".js-tabs-panel"),
  template: document.querySelector("#audibleTabTemplate"),
  tickStrip: document.querySelector(".js-tick-strip"),
  unsupportedNote: document.querySelector(".js-unsupported-note"),
  volumeRange: document.querySelector(".js-volume-range"),
  volumeValue: document.querySelector(".js-volume-value")
};

const state = {
  activeTab: null,
  activeTabSupported: false,
  currentState: { ...DEFAULT_AUDIO_STATE },
  initializingCapture: false,
  settings: null
};

function isDefaultAudioState(audioState) {
  return (
    audioState.volume === DEFAULT_AUDIO_STATE.volume &&
    audioState.mono === DEFAULT_AUDIO_STATE.mono &&
    audioState.muted === DEFAULT_AUDIO_STATE.muted
  );
}

function setControlsDisabled(disabled) {
  elements.volumeRange.disabled = disabled;
  elements.monoButton.disabled = disabled;
  elements.muteButton.disabled = disabled;
}

function getAnchorRatio(settings) {
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

function volumeToSliderValue(volume, settings) {
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

function sliderValueToVolume(sliderValue, settings) {
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

function appendTicks(startVolume, endVolume, step, settings) {
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

function renderTicks() {
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

function renderState() {
  elements.volumeValue.textContent = formatVolumeLabel(state.currentState.volume);
  elements.volumeRange.value = String(volumeToSliderValue(state.currentState.volume, state.settings));
  elements.monoButton.classList.toggle("is-active", state.currentState.mono);
  elements.monoButton.setAttribute("aria-pressed", String(state.currentState.mono));
  elements.muteButton.classList.toggle("is-active", state.currentState.muted);
  elements.muteButton.setAttribute("aria-pressed", String(state.currentState.muted));
}

function renderAudibleTabs(tabs) {
  elements.audibleList.textContent = "";
  elements.audibleCount.textContent = String(tabs.length);
  elements.emptyState.classList.toggle("is-hidden", tabs.length > 0);

  tabs.forEach((tab) => {
    const fragment = elements.template.content.cloneNode(true);
    const button = fragment.querySelector(".tab-chip");
    const icon = fragment.querySelector(".tab-chip__icon");
    const site = fragment.querySelector(".tab-chip__site");
    const status = fragment.querySelector(".tab-chip__status");
    const label = tab.title || getSiteLabel(tab.url);
    const badges = [];

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

function renderOverview() {
  const activeUrl = state.activeTab?.url || "";
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

async function applyState(nextState) {
  if (!state.activeTab?.id || !state.activeTabSupported || !state.settings) {
    return;
  }

  const normalizedState = {
    volume: snapVolumeToStep(
      clampVolume(nextState.volume, state.settings.maxVolume, state.settings.minVolume),
      state.settings
    ),
    mono: Boolean(nextState.mono),
    muted: Boolean(nextState.muted)
  };

  state.currentState = normalizedState;
  renderState();

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.POPUP_APPLY_AUDIO,
    tabId: state.activeTab.id,
    url: state.activeTab.url,
    ...normalizedState
  });

  if (response?.error) {
    throw new Error(response.error);
  }

  state.currentState = response;
  renderState();
}

async function initializeCaptureFromPopup() {
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

    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.POPUP_APPLY_AUDIO,
      tabId: state.activeTab.id,
      url: state.activeTab.url,
      mediaStreamId,
      ...state.currentState
    });

    if (response?.error) {
      throw new Error(response.error);
    }

    state.currentState = response;
    renderState();
  } finally {
    state.initializingCapture = false;
  }
}

async function loadPopup() {
  const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.POPUP_GET_STATE });

  if (response?.error) {
    throw new Error(response.error);
  }

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

function bindEvents() {
  elements.openSettings.addEventListener("click", async () => {
    await chrome.runtime.openOptionsPage();
  });

  elements.volumeRange.addEventListener("input", async (event) => {
    await applyState({
      ...state.currentState,
      volume: snapVolumeToStep(
        sliderValueToVolume(Number(event.target.value), state.settings),
        state.settings
      )
    });
  });

  elements.monoButton.addEventListener("click", async () => {
    await applyState({
      ...state.currentState,
      mono: !state.currentState.mono
    });
  });

  elements.muteButton.addEventListener("click", async () => {
    await applyState({
      ...state.currentState,
      muted: !state.currentState.muted
    });
  });

  elements.audibleList.addEventListener("click", async (event) => {
    const button = event.target.closest(".tab-chip");

    if (!button) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.POPUP_FOCUS_TAB,
      tabId: Number(button.dataset.tabId)
    });

    window.close();
  });
}

bindEvents();
loadPopup().catch((error) => {
  console.error("Popup failed to load", error);
  elements.siteLabel.textContent = "Unavailable";
  setControlsDisabled(true);
});