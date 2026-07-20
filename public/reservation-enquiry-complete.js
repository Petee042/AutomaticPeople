'use strict';

const RESERVATION_ENQUIRY_COMPLETION_KEY = 'reservationEnquiryCompletionContext';

const DISPLAY_WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DISPLAY_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function padDisplayNumber(value) {
  return String(Number(value || 0)).padStart(2, '0');
}

function formatCompletionMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '-';
  }
  return 'GBP ' + amount.toFixed(2);
}

function formatCompletionDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text || '-';
  }
  const dt = new Date(text + 'T00:00:00');
  if (!Number.isFinite(dt.getTime())) {
    return text;
  }
  return DISPLAY_WEEKDAY_SHORT[dt.getDay()] + ' '
    + padDisplayNumber(dt.getDate()) + ' '
    + DISPLAY_MONTH_SHORT[dt.getMonth()] + ' '
    + String(dt.getFullYear());
}

function loadCompletionData() {
  const raw = window.sessionStorage.getItem(RESERVATION_ENQUIRY_COMPLETION_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCompletionMessage(text, isError) {
  const el = document.getElementById('completionMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text
    ? ('message ' + (isError ? 'error' : 'success'))
    : 'message hidden';
}

(function initCompletionPage() {
  const data = loadCompletionData();
  
  if (!data) {
    document.body.innerHTML = '<main class="dashboard"><div class="card-container wide"><h2>Error</h2><p>Completion data is missing. Please contact support.</p></div></main>';
    return;
  }

  document.getElementById('completionStay').textContent = formatCompletionDate(data.arrivalDate) + ' to ' + formatCompletionDate(data.departureDate);
  document.getElementById('completionGuests').textContent = String(data.guestCount || '');
  document.getElementById('completionOption').textContent = String(data.option && data.option.label || '');
  document.getElementById('completionAmount').textContent = formatCompletionMoney(data.totalAmount);

  const isOnlinePayment = data.paymentMode === 'online';

  if (isOnlinePayment) {
    const titleEl = document.getElementById('completionTitle');
    if (titleEl) titleEl.textContent = 'Payment Confirmed';

    const bankSection = document.getElementById('completionBankSection');
    if (bankSection) bankSection.classList.add('hidden');

    const holdSection = document.getElementById('completionHoldSection');
    if (holdSection) holdSection.classList.add('hidden');

    const onlineNote = document.getElementById('completionOnlineNote');
    if (onlineNote) {
      onlineNote.classList.remove('hidden');
      if (data.emailDeliveryWarning === true) {
        onlineNote.innerHTML = '<p class="completion-note">Your reservation is confirmed, but the confirmation email could not be sent. Please keep this page for your records and contact support if needed.</p>';
      }
    }

    const paymentStatusText = data.paymentStatus ? (' Status: ' + data.paymentStatus + '.') : '';
    if (data.emailDeliveryWarning === true) {
      const reason = String(data.emailDeliveryReason || '').trim();
      setCompletionMessage(
        reason
          ? ('Your payment was confirmed, but email delivery failed: ' + reason)
          : 'Your payment was confirmed, but confirmation email delivery failed.',
        true
      );
    } else {
      setCompletionMessage('Your payment was confirmed and reservation is now active.' + paymentStatusText, false);
    }
  } else {
    if (data.emailDeliveryWarning === true) {
      const reason = String(data.emailDeliveryReason || '').trim();
      setCompletionMessage(
        reason
          ? ('Reservation request submitted, but payment email delivery failed: ' + reason)
          : 'Reservation request submitted, but payment email delivery failed. Please contact support.',
        true
      );
    } else {
      setCompletionMessage('Reservation request submitted and payment email sent.', false);
    }

    if (data.bankAccount) {
      document.getElementById('completionAccountName').textContent = String(data.bankAccount.accountName || '');
      document.getElementById('completionAccountType').textContent = String(data.bankAccount.accountType || '');
      document.getElementById('completionSortCode').textContent = String(data.bankAccount.sortCode || '');
      document.getElementById('completionAccountNumber').textContent = String(data.bankAccount.accountNumber || '');
      document.getElementById('completionIban').textContent = String(data.bankAccount.iban || '');
      document.getElementById('completionBic').textContent = String(data.bankAccount.bic || '');
    }
  }

  window.sessionStorage.removeItem(RESERVATION_ENQUIRY_COMPLETION_KEY);
})();
