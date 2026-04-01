import {
  DEFAULT_AUDIO_STATE,
  MESSAGE_TARGETS,
  MESSAGE_TYPES,
  OFFSCREEN_DOCUMENT_PATH,
  getSiteKey,
  isSupportedTabUrl,
  normalizeAudioState
} from "../shared/constants.js";
import {
  getSettings,
  getSiteProfile,
  saveSiteProfile
} from "../shared/storage.js";
import {
  isRuntimeErrorResponse,
  type AudioApplyMessage,
  type AudioGetStateMessage,
  type AudioReleaseMessage,
  type AudioState,
  type AudibleTabSummary,
  type OffscreenRuntimeMessage,
  type OkResponse,
  type PopupState,
  type RuntimeErrorResponse,
  type RuntimeRequestMessage,
  type Settings
} from "../shared/types.js";

interface RuntimeContextDescriptor {
  documentUrl?: string;
}

type RuntimeWithContexts = typeof chrome.runtime & {
  getContexts?: (filter: {
    contextTypes: string[];
    documentUrls: string[];
  }) => Promise<RuntimeContextDescriptor[]>;
};

type ActionWithBadgeTextColor = typeof chrome.action & {
  setBadgeTextColor?: (details: { color: string }) => Promise<void>;
};

interface OffscreenRequestOptions {
  ensureDocument?: boolean;
}

interface ApplyAudioStateOptions {
  mediaStreamId?: string | undefined;
  persist?: boolean | undefined;
}

interface TabTarget {
  id: number;
  url: string;
}

const runtimeWithContexts = chrome.runtime as RuntimeWithContexts;
const actionWithBadgeTextColor = chrome.action as ActionWithBadgeTextColor;

let offscreenSetupPromise: Promise<void> | null = null;
const tabAudioOperationPromises = new Map<number, Promise<unknown>>();
const tabAppliedSiteKeys = new Map<number, string>();

function isRuntimeRequestMessage(message: unknown): message is RuntimeRequestMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    typeof (message as { type: unknown }).type === "string"
  );
}

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist")
  );
}

function isMissingTabError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No tab with id");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function unwrapOffscreenResponse<T>(response: T | RuntimeErrorResponse): T {
  if (isRuntimeErrorResponse(response)) {
    throw new Error(response.error);
  }

  return response;
}

async function runTabAudioOperation<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const previousOperation = tabAudioOperationPromises.get(tabId) ?? Promise.resolve();
  const nextOperation = previousOperation.catch(() => undefined).then(operation);

  tabAudioOperationPromises.set(tabId, nextOperation);

  try {
    return await nextOperation;
  } finally {
    if (tabAudioOperationPromises.get(tabId) === nextOperation) {
      tabAudioOperationPromises.delete(tabId);
    }
  }
}

async function offscreenDocumentExists(): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const getContexts = runtimeWithContexts.getContexts;

  if (typeof getContexts === "function") {
    const contexts = await getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    return contexts.length > 0;
  }

  const serviceWorkerScope = globalThis as unknown as ServiceWorkerGlobalScope;
  const matchedClients = await serviceWorkerScope.clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenDocument(): Promise<void> {
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

async function sendToOffscreen(
  message: AudioGetStateMessage,
  options?: OffscreenRequestOptions
): Promise<AudioState | null>;
async function sendToOffscreen(
  message: AudioApplyMessage,
  options?: OffscreenRequestOptions
): Promise<AudioState>;
async function sendToOffscreen(
  message: AudioReleaseMessage,
  options?: OffscreenRequestOptions
): Promise<OkResponse | null>;
async function sendToOffscreen(
  message: AudioGetStateMessage | AudioApplyMessage | AudioReleaseMessage,
  { ensureDocument = false }: OffscreenRequestOptions = {}
): Promise<AudioState | OkResponse | null> {
  if (ensureDocument) {
    await ensureOffscreenDocument();
  } else if (!(await offscreenDocumentExists())) {
    return null;
  }

  const envelopedMessage = {
    ...message,
    target: MESSAGE_TARGETS.OFFSCREEN
  } as OffscreenRuntimeMessage;

  try {
    return unwrapOffscreenResponse(
      (await chrome.runtime.sendMessage(envelopedMessage)) as
        | AudioState
        | OkResponse
        | RuntimeErrorResponse
        | null
    );
  } catch (error: unknown) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    if (!ensureDocument) {
      return null;
    }

    await delay(50);
    return unwrapOffscreenResponse(
      (await chrome.runtime.sendMessage(envelopedMessage)) as
        | AudioState
        | OkResponse
        | RuntimeErrorResponse
        | null
    );
  }
}

async function releaseTabResources(tabId: number): Promise<void> {
  tabAppliedSiteKeys.delete(tabId);
  await sendToOffscreen({ type: MESSAGE_TYPES.AUDIO_RELEASE, tabId }, { ensureDocument: false });
}

async function updateBadge(tabId: number, state: Readonly<AudioState>): Promise<void> {
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

async function updatePendingCaptureBadge(tabId: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#d97706"
  });

  await chrome.action.setBadgeText({
    tabId,
    text: "!"
  });
}

function areAudioStatesEqual(
  left: Readonly<AudioState> | null | undefined,
  right: Readonly<AudioState> | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  return left.volume === right.volume && left.mono === right.mono && left.muted === right.muted;
}

function needsUserCaptureInitialization(
  liveState: AudioState | null,
  desiredState: Readonly<AudioState>
): boolean {
  return !liveState && !areAudioStatesEqual(desiredState, DEFAULT_AUDIO_STATE);
}

function hasTabId(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & { id: number } {
  return typeof tab.id === "number";
}

async function getAudibleTabs(settings: Readonly<Settings>): Promise<AudibleTabSummary[]> {
  const tabs = await chrome.tabs.query({ audible: true });
  const sortedTabs = tabs
    .filter(hasTabId)
    .sort((left, right) => ((left.lastAccessed ?? 0) < (right.lastAccessed ?? 0) ? 1 : -1));

  return Promise.all(
    sortedTabs.map(async (tab) => ({
      id: tab.id,
      title: tab.title || "Untitled tab",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      active: Boolean(tab.active),
      audioState: await getAudioState(tab.id, settings)
    }))
  );
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab ?? null;
}

async function getAudioState(tabId: number, settings: Readonly<Settings>): Promise<AudioState | null> {
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

async function captureAndApplyState(tabId: number, state: Readonly<AudioState>): Promise<AudioState> {
  const mediaStreamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  return captureAndApplyStateWithStreamId(tabId, state, mediaStreamId);
}

async function captureAndApplyStateWithStreamId(
  tabId: number,
  state: Readonly<AudioState>,
  mediaStreamId: string
): Promise<AudioState> {
  return unwrapOffscreenResponse(
    await sendToOffscreen(
      {
        type: MESSAGE_TYPES.AUDIO_APPLY,
        tabId,
        mediaStreamId,
        ...state
      },
      { ensureDocument: true }
    )
  );
}

async function applyAudioStateToTab(
  tabId: number,
  url: string,
  nextState: Readonly<AudioState>,
  options: ApplyAudioStateOptions = {}
): Promise<AudioState> {
  return runTabAudioOperation(tabId, async () => {
    const settings = await getSettings();
    const normalizedState = normalizeAudioState(
      { ...nextState, minVolume: settings.minVolume },
      settings.maxVolume
    );
    const currentAudioState = await getAudioState(tabId, settings);

    try {
      if (currentAudioState) {
        unwrapOffscreenResponse(
          await sendToOffscreen(
            {
              type: MESSAGE_TYPES.AUDIO_APPLY,
              tabId,
              ...normalizedState
            },
            { ensureDocument: true }
          )
        );
      } else if (options.mediaStreamId) {
        await captureAndApplyStateWithStreamId(tabId, normalizedState, options.mediaStreamId);
      } else {
        await captureAndApplyState(tabId, normalizedState);
      }

      await updateBadge(tabId, normalizedState);

      const siteKey = getSiteKey(url);

      if (siteKey) {
        tabAppliedSiteKeys.set(tabId, siteKey);
      } else {
        tabAppliedSiteKeys.delete(tabId);
      }

      if (options.persist !== false && settings.persistPerSite && isSupportedTabUrl(url)) {
        await saveSiteProfile(url, normalizedState, settings);
      }

      return normalizedState;
    } catch (error: unknown) {
      if (isMissingTabError(error)) {
        await releaseTabResources(tabId);
      } else {
        console.warn("Unable to apply audio state", { tabId, url, error });
      }

      throw error;
    }
  });
}

async function maybeApplySavedState(tab: TabTarget): Promise<AudioState | null> {
  try {
    if (!isSupportedTabUrl(tab.url)) {
      tabAppliedSiteKeys.delete(tab.id);
      await updateBadge(tab.id, DEFAULT_AUDIO_STATE);
      return null;
    }

    const settings = await getSettings();
    const siteKey = getSiteKey(tab.url);

    if (!siteKey) {
      tabAppliedSiteKeys.delete(tab.id);
      await updateBadge(tab.id, DEFAULT_AUDIO_STATE);
      return null;
    }

    const liveState = await getAudioState(tab.id, settings);
    const savedState = await getSiteProfile(tab.url, settings);
    const desiredState = savedState ?? normalizeAudioState({}, settings.maxVolume);
    const appliedSiteKey = tabAppliedSiteKeys.get(tab.id) ?? null;

    if (!settings.autoApplySavedLevels) {
      tabAppliedSiteKeys.set(tab.id, siteKey);
      const resolvedState = savedState ?? liveState ?? desiredState;
      await updateBadge(tab.id, resolvedState);
      return resolvedState;
    }

    if (needsUserCaptureInitialization(liveState, desiredState)) {
      tabAppliedSiteKeys.set(tab.id, siteKey);
      await updatePendingCaptureBadge(tab.id);
      return desiredState;
    }

    if (!savedState && !liveState) {
      tabAppliedSiteKeys.set(tab.id, siteKey);
      await updateBadge(tab.id, desiredState);
      return desiredState;
    }

    if (liveState && appliedSiteKey === siteKey && areAudioStatesEqual(liveState, desiredState)) {
      await updateBadge(tab.id, liveState);
      return liveState;
    }

    try {
      return await applyAudioStateToTab(tab.id, tab.url, desiredState, { persist: false });
    } catch {
      const fallbackState = liveState ?? desiredState;
      await updateBadge(tab.id, fallbackState);
      return fallbackState;
    }
  } catch (error: unknown) {
    if (isMissingTabError(error)) {
      await releaseTabResources(tab.id);
      return null;
    }

    throw error;
  }
}

async function buildPopupState(): Promise<PopupState> {
  const settings = await getSettings();
  const activeTab = await getActiveTab();
  const activeTabSupported = Boolean(activeTab?.id && isSupportedTabUrl(activeTab.url));
  const resolvedState =
    activeTabSupported && activeTab?.id
      ? await maybeApplySavedState({ id: activeTab.id, url: activeTab.url || "" })
      : null;
  const savedState = activeTabSupported ? await getSiteProfile(activeTab?.url || "", settings) : null;
  const liveState = activeTab?.id ? await getAudioState(activeTab.id, settings) : null;
  const activeSiteKey = activeTabSupported ? getSiteKey(activeTab?.url || "") : null;
  const appliedSiteKey = activeTab?.id ? tabAppliedSiteKeys.get(activeTab.id) ?? null : null;
  const currentState =
    resolvedState ??
    (activeTabSupported && liveState && appliedSiteKey === activeSiteKey
      ? liveState
      : savedState ?? normalizeAudioState({}, settings.maxVolume));
  const needsTabCaptureInit = Boolean(activeTabSupported && activeTab?.id) &&
    needsUserCaptureInitialization(liveState, currentState);

  return {
    activeTab:
      activeTab && typeof activeTab.id === "number"
        ? {
            id: activeTab.id,
            title: activeTab.title || "Untitled tab",
            url: activeTab.url || "",
            audible: Boolean(activeTab.audible)
          }
        : null,
    activeTabSupported,
    currentState,
    needsTabCaptureInit,
    settings,
    audibleTabs: settings.showAudibleTabs ? await getAudibleTabs(settings) : []
  };
}

async function handleRuntimeMessage(
  message: RuntimeRequestMessage,
  sender: chrome.runtime.MessageSender
): Promise<PopupState | AudioState | OkResponse | null> {
  switch (message.type) {
    case MESSAGE_TYPES.POPUP_GET_STATE:
      return buildPopupState();

    case MESSAGE_TYPES.POPUP_APPLY_AUDIO:
      return applyAudioStateToTab(
        message.tabId,
        message.url,
        {
          volume: message.volume,
          mono: message.mono,
          muted: message.muted
        },
        {
          mediaStreamId: message.mediaStreamId
        }
      );

    case MESSAGE_TYPES.POPUP_FOCUS_TAB: {
      const focusedTab = await chrome.tabs.update(message.tabId, { active: true });

      if (!focusedTab) {
        throw new Error(`Unable to focus tab ${message.tabId}`);
      }

      await chrome.windows.update(focusedTab.windowId, { focused: true });
      return { ok: true };
    }

    case MESSAGE_TYPES.CONTENT_NAVIGATED:
      if (typeof sender.tab?.id === "number") {
        await maybeApplySavedState({
          id: sender.tab.id,
          url: message.url || sender.tab.url || ""
        });
      }

      return { ok: true };

    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeRequestMessage(message)) {
    return undefined;
  }

  void handleRuntimeMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      console.error("Service worker message handling failed", error);
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.audible === true || typeof changeInfo.url === "string") {
    const url = tab.url || changeInfo.url || "";

    void maybeApplySavedState({ id: tabId, url }).catch((error: unknown) => {
      console.error("Unable to sync saved state after tab update", { tabId, url, error });
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void releaseTabResources(tabId).catch((error: unknown) => {
    console.error("Unable to release tab resources", { tabId, error });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  if (typeof actionWithBadgeTextColor.setBadgeTextColor === "function") {
    void actionWithBadgeTextColor.setBadgeTextColor({ color: "#fff" });
  }
});