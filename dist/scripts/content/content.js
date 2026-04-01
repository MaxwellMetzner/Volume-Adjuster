"use strict";
const CONTENT_NAVIGATED_MESSAGE_TYPE = "content:navigated";
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
        void chrome.runtime.sendMessage(message).catch(() => undefined);
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
