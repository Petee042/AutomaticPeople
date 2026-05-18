'use strict';

(function initBottomNav() {
  const path = window.location.pathname;
  if (!path || path === '/' || path === '/index.html') {
    return;
  }

  const nav = document.createElement('nav');
  nav.className = 'app-bottom-nav';
  nav.setAttribute('aria-label', 'Main navigation');

  const items = [
    { key: 'dashboard', href: '/dashboard.html', label: 'Dashboard' },
    { key: 'properties', href: '/dashboard.html#propertiesSection', label: 'Properties' },
    { key: 'listings', href: '/dashboard.html#listingsSection', label: 'Listings' },
    { key: 'resources', href: '/dashboard.html#resourcesSection', label: 'Resources' }
  ];

  const activeKey = resolveActiveKey(path);

  items.forEach((item) => {
    const link = document.createElement('a');
    link.href = item.href;
    link.className = 'app-bottom-nav-link' + (item.key === activeKey ? ' is-active' : '');
    link.setAttribute('aria-current', item.key === activeKey ? 'page' : 'false');
    link.textContent = item.label;
    nav.appendChild(link);
  });

  document.body.classList.add('has-bottom-nav');
  document.body.appendChild(nav);

  function resolveActiveKey(currentPath) {
    if (currentPath === '/property.html') {
      return 'properties';
    }
    if (currentPath === '/listing.html') {
      return 'listings';
    }
    if (currentPath === '/shared-resource.html' || currentPath === '/shared-resource-reservation-edit.html') {
      return 'resources';
    }
    return 'dashboard';
  }
})();