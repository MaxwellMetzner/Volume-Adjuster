const CONTENT_NAVIGATED_MESSAGE_TYPE = "content:navigated" as const;

interface ContentNavigatedMessage {
  type: typeof CONTENT_NAVIGATED_MESSAGE_TYPE;
  url: string;
}

interface RuntimeMessagingApi {
  id?: string;
  sendMessage(message: ContentNavigatedMessage): Promise<unknown>;
}

function getRuntimeMessagingApi(): RuntimeMessagingApi | null {
  const runtime = (globalThis as typeof globalThis & {
    chrome?: {
      runtime?: RuntimeMessagingApi;
    };
  }).chrome?.runtime;

  if (!runtime?.id || typeof runtime.sendMessage !== "function") {
    return null;
  }

  return runtime;
}

function sendNavigationMessage(message: ContentNavigatedMessage): void {
  const runtime = getRuntimeMessagingApi();

  if (!runtime) {
    return;
  }

  try {
    void runtime.sendMessage(message).catch(() => undefined);
  } catch {
    return;
  }
}

(() => {
  if (window.top !== window) {
    return;
  }

  type HistoryMethod = History["pushState"];
  type HistoryMethodName = "pushState" | "replaceState";

  let lastUrl = "";

  function notifyNavigation(): void {
    const currentUrl = window.location.href;

    if (currentUrl === lastUrl) {
      return;
    }

    lastUrl = currentUrl;

    const message: ContentNavigatedMessage = {
      type: CONTENT_NAVIGATED_MESSAGE_TYPE,
      url: currentUrl
    };

    sendNavigationMessage(message);
  }

  function wrapHistoryMethod(methodName: HistoryMethodName): void {
    const originalMethod = history[methodName].bind(history) as HistoryMethod;

    history[methodName] = ((...args: Parameters<HistoryMethod>): ReturnType<HistoryMethod> => {
      const result = originalMethod(...args);
      queueMicrotask(notifyNavigation);
      return result;
    }) as HistoryMethod;
  }

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  window.addEventListener("popstate", notifyNavigation);
  window.addEventListener("hashchange", notifyNavigation);
  window.addEventListener("pageshow", notifyNavigation);
  document.addEventListener("DOMContentLoaded", notifyNavigation, { once: true });

  notifyNavigation();
})();