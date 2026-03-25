import {
  DEFAULT_AUDIO_STATE,
  MESSAGE_TARGETS,
  MESSAGE_TYPES,
  OFFSCREEN_DOCUMENT_PATH,
  formatVolumeLabel,
  isSupportedTabUrl,
  normalizeAudioState
} from "../shared/constants.js";
import {
  getSettings,
  getSiteProfile,
  getSiteProfiles,
  removeSiteProfile,
  resetSiteProfiles,
  saveSiteProfile
} from "../shared/storage.js";

let offscreenSetupPromise = null;

async function offscreenDocumentExists() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenDocument() {
  if (await offscreenDocumentExists()) {
    return;
  }

  if (!offscreenSetupPromise) {
    offscreenSetupPromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["USER_MEDIA"],
        justification: "Process tab audio with gain control and mono output."
      })
      .finally(() => {
        offscreenSetupPromise = null;
      });
  }

  await offscreenSetupPromise;
}

async function sendToOffscreen(message, { ensureDocument = false } = {}) {
  if (ensureDocument) {
    await ensureOffscreenDocument();
  } else if (!(await offscreenDocumentExists())) {
    return null;
  }

  return chrome.runtime.sendMessage({ ...message, target: MESSAGE_TARGETS.OFFSCREEN });
}

async function updateBadge(tabId, state) {
  const isDefaultState =
    state.volume === DEFAULT_AUDIO_STATE.volume &&
    state.mono === DEFAULT_AUDIO_STATE.mono &&
    state.muted === DEFAULT_AUDIO_STATE.muted;

  let badgeColor = "#6b7280";

  if (state.muted) {
    badgeColor = "#b91c1c";
  } else if (state.volume < DEFAULT_AUDIO_STATE.volume) {
    badgeColor = "#2563eb";
  } else if (state.volume > DEFAULT_AUDIO_STATE.volume) {
    badgeColor = "#c2410c";
  }

  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: badgeColor
  });

  await chrome.action.setBadgeText({
    tabId,
    text: isDefaultState ? "" : state.muted ? "M" : `${Math.round(state.volume)}`
  });
}

async function getAudibleTabs(settings) {
  const tabs = await chrome.tabs.query({ audible: true });
  const sortedTabs = tabs.sort((left, right) => (left.lastAccessed ?? 0) < (right.lastAccessed ?? 0) ? 1 : -1);

  return Promise.all(
    sortedTabs.map(async (tab) => ({
      id: tab.id,
      title: tab.title || "Untitled tab",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      active: Boolean(tab.active),
      audioState: tab.id ? await getAudioState(tab.id, settings) : null
    }))
  );
}

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab ?? null;
}

async function getAudioState(tabId, settings) {
  const currentAudioState = await sendToOffscreen(
    { type: MESSAGE_TYPES.AUDIO_GET_STATE, tabId },
    { ensureDocument: false }
  );

  return currentAudioState
    ? normalizeAudioState(
        { ...currentAudioState, minVolume: settings.minVolume },
        settings.maxVolume
      )
    : null;
}

async function captureAndApplyState(tabId, state) {
  const mediaStreamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  return sendToOffscreen(
    {
      type: MESSAGE_TYPES.AUDIO_APPLY,
      tabId,
      mediaStreamId,
      ...state
    },
    { ensureDocument: true }
  );
}

async function applyAudioStateToTab(tabId, url, nextState, options = {}) {
  const settings = await getSettings();
  const normalizedState = normalizeAudioState(
    { ...nextState, minVolume: settings.minVolume },
    settings.maxVolume
  );
  const currentAudioState = await getAudioState(tabId, settings);

  try {
    if (currentAudioState) {
      await sendToOffscreen(
        {
          type: MESSAGE_TYPES.AUDIO_APPLY,
          tabId,
          ...normalizedState
        },
        { ensureDocument: true }
      );
    } else {
      await captureAndApplyState(tabId, normalizedState);
    }

    await updateBadge(tabId, normalizedState);

    if (options.persist !== false && settings.persistPerSite && isSupportedTabUrl(url)) {
      await saveSiteProfile(url, normalizedState, settings);
    }

    return normalizedState;
  } catch (error) {
    console.warn("Unable to apply audio state", { tabId, url, error });
    throw error;
  }
}

async function maybeApplySavedState(tab) {
  if (!tab?.id || !isSupportedTabUrl(tab.url)) {
    return null;
  }

  const settings = await getSettings();

  if (!settings.autoApplySavedLevels) {
    return null;
  }

  const savedState = await getSiteProfile(tab.url, settings);

  if (!savedState) {
    return null;
  }

  if (
    savedState.volume === DEFAULT_AUDIO_STATE.volume &&
    savedState.mono === DEFAULT_AUDIO_STATE.mono &&
    savedState.muted === DEFAULT_AUDIO_STATE.muted
  ) {
    return null;
  }

  try {
    return await applyAudioStateToTab(tab.id, tab.url, savedState, { persist: false });
  } catch {
    return null;
  }
}

async function buildPopupState() {
  const settings = await getSettings();
  const activeTab = await getActiveTab();
  const activeTabSupported = Boolean(activeTab?.id && isSupportedTabUrl(activeTab.url));
  const savedState = activeTabSupported ? await getSiteProfile(activeTab.url, settings) : null;
  const liveState = activeTab?.id ? await getAudioState(activeTab.id, settings) : null;
  const currentState = liveState ?? savedState ?? normalizeAudioState({}, settings.maxVolume);

  return {
    activeTab: activeTab
      ? {
          id: activeTab.id,
          title: activeTab.title || "Untitled tab",
          url: activeTab.url || "",
          audible: Boolean(activeTab.audible)
        }
      : null,
    activeTabSupported,
    currentState,
    currentStateLabel: formatVolumeLabel(currentState.volume),
    settings,
    audibleTabs: settings.showAudibleTabs ? await getAudibleTabs(settings) : []
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return undefined;
  }

  (async () => {
    switch (message.type) {
      case MESSAGE_TYPES.POPUP_GET_STATE:
        return buildPopupState();

      case MESSAGE_TYPES.POPUP_APPLY_AUDIO:
        return applyAudioStateToTab(message.tabId, message.url, {
          volume: message.volume,
          mono: message.mono,
          muted: message.muted
        });

      case MESSAGE_TYPES.POPUP_FOCUS_TAB: {
        const focusedTab = await chrome.tabs.update(message.tabId, { active: true });
        await chrome.windows.update(focusedTab.windowId, { focused: true });
        return { ok: true };
      }

      case MESSAGE_TYPES.OPTIONS_GET_DATA: {
        const settings = await getSettings();
        const profiles = await getSiteProfiles();
        return { settings, profiles };
      }

      case MESSAGE_TYPES.OPTIONS_REMOVE_PROFILE:
        await removeSiteProfile(message.siteKey);
        return { ok: true };

      case MESSAGE_TYPES.OPTIONS_RESET_PROFILES:
        await resetSiteProfiles();
        return { ok: true };

      case MESSAGE_TYPES.CONTENT_NAVIGATED:
        if (sender.tab?.id) {
          await maybeApplySavedState({
            id: sender.tab.id,
            url: message.url || sender.tab.url || ""
          });
        }
        return { ok: true };

      default:
        return null;
    }
  })()
    .then(sendResponse)
    .catch((error) => {
      console.error("Service worker message handling failed", error);
      sendResponse({ error: error.message });
    });

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.audible === true || typeof changeInfo.url === "string") {
    await maybeApplySavedState({ id: tabId, url: tab.url || changeInfo.url || "" });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await sendToOffscreen({ type: MESSAGE_TYPES.AUDIO_RELEASE, tabId }, { ensureDocument: false });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeTextColor?.({ color: "#fff" });
});