export interface AudioState {
  volume: number;
  mono: boolean;
  muted: boolean;
}

export interface AudioStateCandidate {
  volume?: number | string | null | undefined;
  mono?: boolean | null | undefined;
  muted?: boolean | null | undefined;
  minVolume?: number | string | null | undefined;
}

export interface Settings {
  minVolume: number;
  maxVolume: number;
  stepBelow100: number;
  stepAbove100: number;
  persistPerSite: boolean;
  autoApplySavedLevels: boolean;
  showAudibleTabs: boolean;
}

export interface SettingsCandidate {
  minVolume?: number | string | null | undefined;
  maxVolume?: number | string | null | undefined;
  stepBelow100?: number | string | null | undefined;
  stepAbove100?: number | string | null | undefined;
  persistPerSite?: boolean | null | undefined;
  autoApplySavedLevels?: boolean | null | undefined;
  showAudibleTabs?: boolean | null | undefined;
}

export type SiteProfiles = Record<string, AudioState>;

export interface PopupActiveTab {
  id: number;
  title: string;
  url: string;
  audible: boolean;
}

export interface AudibleTabSummary {
  id: number;
  title: string;
  url: string;
  favIconUrl: string;
  active: boolean;
  audioState: AudioState | null;
}

export interface PopupState {
  activeTab: PopupActiveTab | null;
  activeTabSupported: boolean;
  currentState: AudioState;
  needsTabCaptureInit: boolean;
  settings: Settings;
  audibleTabs: AudibleTabSummary[];
}

export interface RuntimeErrorResponse {
  error: string;
}

export interface OkResponse {
  ok: true;
}

export interface PopupGetStateMessage {
  type: "popup:get-state";
}

export interface PopupApplyAudioMessage extends AudioState {
  type: "popup:apply-audio";
  tabId: number;
  url: string;
  mediaStreamId?: string | undefined;
}

export interface PopupFocusTabMessage {
  type: "popup:focus-tab";
  tabId: number;
}

export interface ContentNavigatedMessage {
  type: "content:navigated";
  url: string;
}

export type RuntimeRequestMessage =
  | PopupGetStateMessage
  | PopupApplyAudioMessage
  | PopupFocusTabMessage
  | ContentNavigatedMessage;

export interface AudioGetStateMessage {
  type: "audio:get-state";
  tabId: number;
}

export interface AudioApplyMessage extends AudioState {
  type: "audio:apply";
  tabId: number;
  mediaStreamId?: string | undefined;
}

export interface AudioReleaseMessage {
  type: "audio:release";
  tabId: number;
}

export type OffscreenRequestMessage = AudioGetStateMessage | AudioApplyMessage | AudioReleaseMessage;

export type OffscreenRuntimeMessage = OffscreenRequestMessage & {
  target: "offscreen";
};

export function isRuntimeErrorResponse(value: unknown): value is RuntimeErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}