'use strict';

(function ensureNavigationGuardScriptLoaded() {
  if (window.__apNavigationGuardInitialized) {
    return;
  }

  if (document.querySelector('script[data-ap-navigation-guard="1"]')) {
    return;
  }

  const script = document.createElement('script');
  script.src = '/navigation-guard.js';
  script.defer = true;
  script.setAttribute('data-ap-navigation-guard', '1');
  document.head.appendChild(script);
})();

(function initStickyMessageBar() {
  const stickyBar = document.getElementById('stickyMessageBar');
  if (!stickyBar) {
    return;
  }

  const sources = Array.from(document.querySelectorAll('.message, .schedule-email-message'));
  if (!sources.length) {
    return;
  }

  function classify(el) {
    const cls = String((el && el.className) || '');
    if (/\berror\b/i.test(cls)) {
      return 'error';
    }
    if (/\bsuccess\b/i.test(cls)) {
      return 'success';
    }
    return 'info';
  }

  function cleanText(el) {
    return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function writeBar(text, tone) {
    const content = text || 'No current messages.';
    stickyBar.textContent = content;
    stickyBar.className = 'sticky-message-bar' + (tone ? (' ' + tone) : '');
  }

  function refreshFromMessages() {
    const nonEmpty = sources.filter((el) => cleanText(el));
    if (!nonEmpty.length) {
      writeBar('', 'info');
      return;
    }

    const active = nonEmpty[nonEmpty.length - 1];
    writeBar(cleanText(active), classify(active));
  }

  refreshFromMessages();

  const observer = new MutationObserver(() => {
    refreshFromMessages();
  });

  sources.forEach((el) => {
    observer.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });
  });
})();
