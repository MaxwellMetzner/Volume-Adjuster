"use strict";
const CONTENT_NAVIGATED_MESSAGE_TYPE = "content:navigated";
function getRuntimeMessagingApi() {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.id || typeof runtime.sendMessage !== "function") {
        return null;
    }
    return runtime;
}
function sendNavigationMessage(message) {
    const runtime = getRuntimeMessagingApi();
    if (!runtime) {
        return;
    }
    try {
        void runtime.sendMessage(message).catch(() => undefined);
    }
    catch {
        return;
    }
}
(() => {
    if (window.top !== window) {
        return;
    }
    let lastUrl = "";
    function notifyNavigation() {
        const currentUrl = window.location.href;
        if (currentUrl === lastUrl) {
            return;
        }
        lastUrl = currentUrl;
        const message = {
            type: CONTENT_NAVIGATED_MESSAGE_TYPE,
            url: currentUrl
        };
        sendNavigationMessage(message);
    }
    function wrapHistoryMethod(methodName) {
        const originalMethod = history[methodName].bind(history);
        history[methodName] = ((...args) => {
            const result = originalMethod(...args);
            queueMicrotask(notifyNavigation);
            return result;
        });
    }
    wrapHistoryMethod("pushState");
    wrapHistoryMethod("replaceState");
    window.addEventListener("popstate", notifyNavigation);
    window.addEventListener("hashchange", notifyNavigation);
    window.addEventListener("pageshow", notifyNavigation);
    document.addEventListener("DOMContentLoaded", notifyNavigation, { once: true });
    notifyNavigation();
})();
