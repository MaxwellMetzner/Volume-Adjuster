import { DEFAULT_AUDIO_STATE, MESSAGE_TARGETS, MESSAGE_TYPES } from "../shared/constants.js";
const tabStates = new Map();
const pendingStates = new Map();
function isOffscreenRuntimeMessage(message) {
    return (typeof message === "object" &&
        message !== null &&
        "target" in message &&
        message.target === MESSAGE_TARGETS.OFFSCREEN &&
        "type" in message &&
        typeof message.type === "string");
}
function volumeToGain(volume) {
    const normalizedVolume = Math.max(0, volume) / 100;
    if (normalizedVolume === 0) {
        return 0;
    }
    return Math.pow(normalizedVolume, 1.05);
}
function syncGainState(state) {
    const nextGain = state.current.muted ? 0 : volumeToGain(state.current.volume);
    const now = state.audioContext.currentTime;
    state.nodes.gainNode.gain.cancelScheduledValues(now);
    state.nodes.gainNode.gain.setTargetAtTime(nextGain, now, 0.015);
}
async function captureTabStream(mediaStreamId) {
    const constraints = {
        audio: {
            mandatory: {
                chromeMediaSource: "tab",
                chromeMediaSourceId: mediaStreamId
            }
        },
        video: false
    };
    return navigator.mediaDevices.getUserMedia(constraints);
}
function createMonoMixer(audioContext, splitter) {
    const monoMerger = audioContext.createChannelMerger(2);
    const leftToLeft = audioContext.createGain();
    const rightToLeft = audioContext.createGain();
    const leftToRight = audioContext.createGain();
    const rightToRight = audioContext.createGain();
    [leftToLeft, rightToLeft, leftToRight, rightToRight].forEach((gainNode) => {
        gainNode.gain.value = 0.5;
    });
    splitter.connect(leftToLeft, 0);
    splitter.connect(rightToLeft, 1);
    splitter.connect(leftToRight, 0);
    splitter.connect(rightToRight, 1);
    leftToLeft.connect(monoMerger, 0, 0);
    rightToLeft.connect(monoMerger, 0, 0);
    leftToRight.connect(monoMerger, 0, 1);
    rightToRight.connect(monoMerger, 0, 1);
    return monoMerger;
}
function createStereoMixer(audioContext, splitter) {
    const stereoMerger = audioContext.createChannelMerger(2);
    const leftGain = audioContext.createGain();
    const rightGain = audioContext.createGain();
    splitter.connect(leftGain, 0);
    splitter.connect(rightGain, 1);
    leftGain.connect(stereoMerger, 0, 0);
    rightGain.connect(stereoMerger, 0, 1);
    return stereoMerger;
}
async function createAudioState(tabId, mediaStreamId) {
    const stream = await captureTabStream(mediaStreamId);
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    const splitter = audioContext.createChannelSplitter(2);
    const stereoMerger = createStereoMixer(audioContext, splitter);
    const monoMerger = createMonoMixer(audioContext, splitter);
    const stereoOutput = audioContext.createGain();
    const monoOutput = audioContext.createGain();
    source.connect(gainNode);
    gainNode.connect(splitter);
    stereoMerger.connect(stereoOutput);
    stereoOutput.connect(audioContext.destination);
    monoMerger.connect(monoOutput);
    monoOutput.connect(audioContext.destination);
    const state = {
        tabId,
        stream,
        audioContext,
        nodes: {
            gainNode,
            stereoOutput,
            monoOutput
        },
        current: { ...DEFAULT_AUDIO_STATE }
    };
    await audioContext.resume();
    tabStates.set(tabId, state);
    return state;
}
function applyMonoState(state, mono) {
    const now = state.audioContext.currentTime;
    state.nodes.stereoOutput.gain.cancelScheduledValues(now);
    state.nodes.monoOutput.gain.cancelScheduledValues(now);
    state.nodes.stereoOutput.gain.setTargetAtTime(mono ? 0 : 1, now, 0.015);
    state.nodes.monoOutput.gain.setTargetAtTime(mono ? 1 : 0, now, 0.015);
    state.current.mono = mono;
}
function applyVolumeState(state, volume) {
    state.current.volume = Math.round(volume);
    syncGainState(state);
}
function applyMutedState(state, muted) {
    state.current.muted = muted;
    syncGainState(state);
}
async function getOrCreateState(tabId, mediaStreamId) {
    const existingState = tabStates.get(tabId);
    if (existingState) {
        return existingState;
    }
    const pendingState = pendingStates.get(tabId);
    if (pendingState) {
        return pendingState;
    }
    if (!mediaStreamId) {
        throw new Error("Missing mediaStreamId for new audio state");
    }
    const nextPendingState = createAudioState(tabId, mediaStreamId)
        .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to create tab audio state: ${message}`);
    })
        .finally(() => {
        pendingStates.delete(tabId);
    });
    pendingStates.set(tabId, nextPendingState);
    return nextPendingState;
}
async function releaseAudioState(tabId) {
    const pendingState = pendingStates.get(tabId);
    if (pendingState) {
        try {
            await pendingState;
        }
        catch {
            pendingStates.delete(tabId);
        }
    }
    const state = tabStates.get(tabId);
    if (!state) {
        return { ok: true };
    }
    state.stream.getTracks().forEach((track) => track.stop());
    await state.audioContext.close();
    tabStates.delete(tabId);
    return { ok: true };
}
async function handleOffscreenMessage(message) {
    switch (message.type) {
        case MESSAGE_TYPES.AUDIO_GET_STATE: {
            const state = tabStates.get(message.tabId);
            return state ? { ...state.current } : null;
        }
        case MESSAGE_TYPES.AUDIO_APPLY: {
            const state = await getOrCreateState(message.tabId, message.mediaStreamId);
            applyVolumeState(state, message.volume);
            applyMonoState(state, Boolean(message.mono));
            applyMutedState(state, Boolean(message.muted));
            return { ...state.current };
        }
        case MESSAGE_TYPES.AUDIO_RELEASE:
            return releaseAudioState(message.tabId);
        default:
            return null;
    }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isOffscreenRuntimeMessage(message)) {
        return undefined;
    }
    void handleOffscreenMessage(message)
        .then(sendResponse)
        .catch((error) => {
        const responseMessage = error instanceof Error ? error.message : String(error);
        console.error("Offscreen message handling failed", responseMessage, error);
        sendResponse({ error: responseMessage });
    });
    return true;
});
