import { MESSAGE_TARGETS, MESSAGE_TYPES } from "../shared/constants.js";

const tabStates = new Map();
const pendingStates = new Map();

function volumeToGain(volume) {
  const normalizedVolume = Math.max(0, Number(volume)) / 100;

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
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: mediaStreamId
      }
    },
    video: false
  });
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
    current: {
      volume: 100,
      mono: false,
      muted: false
    }
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
  if (tabStates.has(tabId)) {
    return tabStates.get(tabId);
  }

  if (pendingStates.has(tabId)) {
    return pendingStates.get(tabId);
  }

  if (!mediaStreamId) {
    throw new Error("Missing mediaStreamId for new audio state");
  }

  const pendingState = createAudioState(tabId, mediaStreamId)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to create tab audio state: ${message}`);
    })
    .finally(() => {
      pendingStates.delete(tabId);
    });

  pendingStates.set(tabId, pendingState);
  return pendingState;
}

async function releaseAudioState(tabId) {
  if (pendingStates.has(tabId)) {
    try {
      await pendingStates.get(tabId);
    } catch {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== MESSAGE_TARGETS.OFFSCREEN) {
    return undefined;
  }

  (async () => {
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
  })()
    .then(sendResponse)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Offscreen message handling failed", message, error);
      sendResponse({ error: message });
    });

  return true;
});