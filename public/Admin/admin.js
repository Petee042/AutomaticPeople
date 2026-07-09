'use strict';

let adminUsers = [];

function setAdminMessage(text, isError) {
  const el = document.getElementById('adminMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function setAdminAuthenticated(isAuthenticated) {
  const loginSection = document.getElementById('adminLoginSection');
  const panelSection = document.getElementById('adminPanelSection');

  if (isAuthenticated) {
    loginSection.classList.add('hidden');
    panelSection.classList.remove('hidden');
  } else {
    loginSection.classList.remove('hidden');
    panelSection.classList.add('hidden');
  }
}

function renderUsers(users) {
  adminUsers = users || [];
  const deleteSelect = document.getElementById('adminUserSelect');
  const viewSelect = document.getElementById('adminViewUserSelect');

  deleteSelect.innerHTML = '';
  viewSelect.innerHTML = '';

  if (!adminUsers.length) {
    const deleteOption = document.createElement('option');
    deleteOption.value = '';
    deleteOption.textContent = 'No users found';
    deleteSelect.appendChild(deleteOption);
    deleteSelect.disabled = true;

    const viewOption = document.createElement('option');
    viewOption.value = '';
    viewOption.textContent = 'No users found';
    viewSelect.appendChild(viewOption);
    viewSelect.disabled = true;

    document.getElementById('deleteUserBtn').disabled = true;
    document.getElementById('viewUserDataBtn').setAttribute('aria-disabled', 'true');
    document.getElementById('viewUserDataBtn').href = '/Admin/user-data.html';
    return;
  }

  const allOption = document.createElement('option');
  allOption.value = '__all__';
  allOption.textContent = 'All Users';
  deleteSelect.appendChild(allOption);

  const viewOption = document.createElement('option');
  viewOption.value = '';
  viewOption.textContent = 'Select a user';
  viewSelect.appendChild(viewOption);

  adminUsers.forEach((user) => {
    const deleteUserOption = document.createElement('option');
    deleteUserOption.value = String(user.id);
    deleteUserOption.textContent = (user.email || ('User #' + user.id));
    deleteSelect.appendChild(deleteUserOption);

    const viewUserOption = document.createElement('option');
    viewUserOption.value = String(user.id);
    viewUserOption.textContent = (user.email || ('User #' + user.id));
    viewSelect.appendChild(viewUserOption);
  });

  deleteSelect.disabled = false;
  viewSelect.disabled = false;
  document.getElementById('deleteUserBtn').disabled = false;
  updateViewUserDataLink();
}

function updateViewUserDataLink() {
  const select = document.getElementById('adminViewUserSelect');
  const link = document.getElementById('viewUserDataBtn');
  if (!select || !link) {
    return;
  }

  const userId = Number(select.value);
  if (!Number.isInteger(userId) || userId <= 0) {
    link.href = '/Admin/user-data.html';
    link.setAttribute('aria-disabled', 'true');
    return;
  }

  link.href = '/Admin/user-data.html?userId=' + encodeURIComponent(String(userId));
  link.removeAttribute('aria-disabled');
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    setAdminAuthenticated(false);
    return false;
  }

  setAdminAuthenticated(true);
  return true;
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  if (res.status === 401) {
    setAdminAuthenticated(false);
    setAdminMessage('Admin login required.', true);
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    setAdminMessage(data.error || 'Failed to load users.', true);
    return;
  }

  renderUsers(data.users || []);
}

(async () => {
  try {
    const isAuthed = await checkAdminSession();
    if (isAuthed) {
      await loadUsers();
    }
  } catch {
    setAdminMessage('Failed to load admin page.', true);
  }
})();

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value;

  if (!username || !password) {
    setAdminMessage('Username and password are required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      setAdminMessage(data.error || 'Admin login failed.', true);
      return;
    }

    setAdminMessage('Admin login successful.', false);
    setAdminAuthenticated(true);
    await loadUsers();
  } catch {
    setAdminMessage('Network error during admin login.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('adminViewUserSelect').addEventListener('change', updateViewUserDataLink);

document.getElementById('viewUserDataBtn').addEventListener('click', (e) => {
  const select = document.getElementById('adminViewUserSelect');
  const userId = Number(select.value);
  if (!Number.isInteger(userId) || userId <= 0) {
    e.preventDefault();
    setAdminMessage('Select a valid user first.', true);
  }
});

document.getElementById('deleteUserBtn').addEventListener('click', async () => {
  const select = document.getElementById('adminUserSelect');
  const selection = String(select.value || '');

  if (!selection) {
    setAdminMessage('Select a valid user first.', true);
    return;
  }

  if (selection === '__all__') {
    if (!adminUsers.length) {
      setAdminMessage('No users to delete.', true);
      return;
    }

    const confirmedAll = window.confirm(
      'Confirm delete ALL users? This permanently removes every user and all associated data.'
    );
    if (!confirmedAll) {
      return;
    }

    const button = document.getElementById('deleteUserBtn');
    button.disabled = true;
    try {
      for (const user of adminUsers) {
        const res = await fetch('/api/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed deleting user ' + (user.email || ('#' + user.id)) + '.');
        }
      }
      setAdminMessage('All users deleted successfully.', false);
      await loadUsers();
    } catch (err) {
      setAdminMessage(err.message || 'Network error deleting all users.', true);
    } finally {
      button.disabled = false;
    }
    return;
  }

  const userId = Number(selection);
  if (!Number.isInteger(userId) || userId <= 0) {
    setAdminMessage('Select a valid user first.', true);
    return;
  }

  const userLabel = select.options[select.selectedIndex]
    ? select.options[select.selectedIndex].textContent
    : 'selected user';

  const confirmed = window.confirm('Confirm delete user: ' + userLabel + '? This removes all associated data.');
  if (!confirmed) {
    return;
  }

  const button = document.getElementById('deleteUserBtn');
  button.disabled = true;
  try {
    const res = await fetch('/api/admin/users/' + encodeURIComponent(userId), {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok) {
      setAdminMessage(data.error || 'Failed to delete user.', true);
      return;
    }

    setAdminMessage('User deleted successfully.', false);
    await loadUsers();
  } catch {
    setAdminMessage('Network error deleting user.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});

document.getElementById('resetSchemaBtn').addEventListener('click', async () => {
  const confirmed = window.confirm(
    'This will permanently delete all data in the connected database and recreate empty tables. Continue?'
  );
  if (!confirmed) {
    return;
  }

  const typed = window.prompt('Type DELETE ALL DATA to confirm this destructive action.');
  if (typed !== 'DELETE ALL DATA') {
    setAdminMessage('Schema reset cancelled. Confirmation text did not match.', true);
    return;
  }

  const button = document.getElementById('resetSchemaBtn');
  button.disabled = true;
  setAdminMessage('Resetting database schema. Please wait...', false);

  try {
    const res = await fetch('/api/admin/system/reset-schema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmText: typed })
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setAdminAuthenticated(false);
      setAdminMessage('Admin login required.', true);
      return;
    }
    if (!res.ok) {
      const detailText = data && data.details ? (' Details: ' + String(data.details)) : '';
      setAdminMessage((data.error || 'Failed to reset schema.') + detailText, true);
      return;
    }

    const modeText = data && data.mode === 'truncate'
      ? ' (truncate fallback mode)'
      : '';
    setAdminMessage('Database schema reset complete and tables recreated.' + modeText, false);
    await loadUsers();
  } catch (err) {
    setAdminMessage(err.message || 'Network error resetting schema.', true);
  } finally {
    button.disabled = false;
  }
});
