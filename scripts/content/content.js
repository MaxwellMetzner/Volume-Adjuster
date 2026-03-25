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
    chrome.runtime.sendMessage({
      type: "content:navigated",
      url: currentUrl,
      title: document.title
    }).catch(() => {
      return undefined;
    });
  }

  function wrapHistoryMethod(methodName) {
    const originalMethod = history[methodName];

    history[methodName] = function wrappedHistoryMethod(...args) {
      const result = originalMethod.apply(this, args);
      queueMicrotask(notifyNavigation);
      return result;
    };
  }

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  window.addEventListener("popstate", notifyNavigation);
  window.addEventListener("hashchange", notifyNavigation);
  window.addEventListener("pageshow", notifyNavigation);
  document.addEventListener("DOMContentLoaded", notifyNavigation, { once: true });

  notifyNavigation();
})();