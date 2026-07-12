'use strict';

(function initNavigationGuard() {
  if (window.__apNavigationGuardInitialized) {
    return;
  }
  window.__apNavigationGuardInitialized = true;

  function toPath(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isSameOriginReferrer() {
    if (!document.referrer) return false;
    try {
      const refUrl = new URL(document.referrer);
      return refUrl.origin === window.location.origin;
    } catch (_err) {
      return false;
    }
  }

  function getFallbackUrl() {
    const path = toPath(window.location.pathname);

    if (path.startsWith('/admin/')) {
      return '/Admin/index.html';
    }

    if (
      path === '/' ||
      path.endsWith('/index.html') ||
      path.startsWith('/public-pages/') ||
      path.startsWith('/reservation-enquiry') ||
      path.endsWith('/guest-terms-and-conditions.html') ||
      path.endsWith('/reset-password.html') ||
      path.endsWith('/validate-account.html')
    ) {
      return '/';
    }

    return '/dashboard.html?tab=panel-dashboard';
  }

  function rewriteAnchorTarget(anchor) {
    if (!anchor) return;
    const target = String(anchor.getAttribute('target') || '').trim().toLowerCase();
    if (target === '_blank') {
      anchor.setAttribute('target', '_self');
      anchor.removeAttribute('rel');
    }
  }

  function enforceSameTabAnchors(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const anchors = scope.querySelectorAll('a[target]');
    anchors.forEach(rewriteAnchorTarget);
  }

  function shouldSkipFallbackNav() {
    if (document.body && document.body.hasAttribute('data-disable-navigation-guard')) {
      return true;
    }

    const path = toPath(window.location.pathname);
    if (path === '/' || path.endsWith('/index.html') || path === '/admin/index.html') {
      return true;
    }

    // If the page already has explicit back/navigation controls, do not add another one.
    const existing = document.querySelector(
      '.back-arrow-control, .btn-back, .back-link, [data-nav-back], #backBtn, [aria-label="Back"]'
    );
    return Boolean(existing);
  }

  function injectFallbackNav() {
    if (shouldSkipFallbackNav()) {
      return;
    }
    if (document.getElementById('apNavigationGuard')) {
      return;
    }

    const container = document.createElement('div');
    container.id = 'apNavigationGuard';
    container.setAttribute('role', 'navigation');
    container.setAttribute('aria-label', 'Page navigation');
    container.style.position = 'fixed';
    container.style.right = '12px';
    container.style.bottom = '12px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.background = 'rgba(15, 23, 42, 0.92)';
    container.style.padding = '8px';
    container.style.borderRadius = '999px';
    container.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.28)';

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = 'Back';
    backBtn.style.border = '1px solid rgba(255, 255, 255, 0.25)';
    backBtn.style.background = '#ffffff';
    backBtn.style.color = '#1f2937';
    backBtn.style.borderRadius = '999px';
    backBtn.style.padding = '6px 12px';
    backBtn.style.fontSize = '0.85rem';
    backBtn.style.fontWeight = '600';
    backBtn.style.cursor = 'pointer';

    const homeLink = document.createElement('a');
    homeLink.href = getFallbackUrl();
    homeLink.textContent = 'Home';
    homeLink.style.display = 'inline-flex';
    homeLink.style.alignItems = 'center';
    homeLink.style.justifyContent = 'center';
    homeLink.style.border = '1px solid rgba(255, 255, 255, 0.35)';
    homeLink.style.background = '#1d4ed8';
    homeLink.style.color = '#ffffff';
    homeLink.style.borderRadius = '999px';
    homeLink.style.padding = '6px 12px';
    homeLink.style.fontSize = '0.85rem';
    homeLink.style.fontWeight = '600';
    homeLink.style.textDecoration = 'none';

    backBtn.addEventListener('click', () => {
      if (window.history.length > 1 && isSameOriginReferrer()) {
        window.history.back();
      } else {
        window.location.href = getFallbackUrl();
      }
    });

    container.appendChild(backBtn);
    container.appendChild(homeLink);
    document.body.appendChild(container);
  }

  enforceSameTabAnchors(document);
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches && node.matches('a[target]')) {
          rewriteAnchorTarget(node);
        }
        if (node.querySelectorAll) {
          enforceSameTabAnchors(node);
        }
      });
    });
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFallbackNav, { once: true });
  } else {
    injectFallbackNav();
  }
})();
