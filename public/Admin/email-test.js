'use strict';

function setEmailTesterMessage(text, isError) {
  const el = document.getElementById('emailTesterMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    window.location.href = '/Admin/index.html';
    return false;
  }
  return true;
}

async function loadEmailConfig() {
  const res = await fetch('/api/admin/email/test/config');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load email configuration.');
  }

  const fromInput = document.getElementById('fromEmail');
  if (fromInput && data.from) {
    fromInput.value = String(data.from);
  }

  if (!data.configured) {
    setEmailTesterMessage('Postmark is not configured on the server yet. Add POSTMARK_SERVER_TOKEN first.', true);
  }
}

async function sendTestMail(payload) {
  const res = await fetch('/api/admin/email/test/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to send test email.');
  }
  return data;
}

(async () => {
  try {
    const isAuthed = await checkAdminSession();
    if (!isAuthed) {
      return;
    }
    await loadEmailConfig();
  } catch (err) {
    setEmailTesterMessage(err.message || 'Failed to initialize email tester.', true);
  }
})();

document.getElementById('emailTestForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const from = String(document.getElementById('fromEmail').value || '').trim();
  const to = String(document.getElementById('toEmail').value || '').trim();
  const subject = String(document.getElementById('subject').value || '').trim();
  const body = String(document.getElementById('body').value || '').trim();
  const sendBtn = document.getElementById('sendTestMailBtn');

  if (!to || !subject || !body) {
    setEmailTesterMessage('To, Subject and Body are required.', true);
    return;
  }

  sendBtn.disabled = true;
  setEmailTesterMessage('Sending test email...', false);

  try {
    const result = await sendTestMail({ from, to, subject, body });
    const idSuffix = result.messageId ? (' Message ID: ' + result.messageId) : '';
    setEmailTesterMessage('Test email sent successfully.' + idSuffix, false);
  } catch (err) {
    setEmailTesterMessage(err.message || 'Failed to send test email.', true);
  } finally {
    sendBtn.disabled = false;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});
