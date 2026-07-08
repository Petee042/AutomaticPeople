'use strict';

function registerWorkflow2PrivateReservationRoutes(app, deps) {
  const {
    requireScopedRole,
    getPrivateReservationsForScope,
    getGuestSiteUsersForClientAccount,
    pool,
    getListingByIdForUser,
    isListingAllowedByScope,
    deleteBookedInChangesForUser,
    normaliseOptionalEmail,
    sendAppEmail,
    ensureGuestSiteUserForClientAccount,
    findUserByEmail,
    mapPrivateReservationRow,
    normaliseDateKey,
    normaliseSharedResourceReservationText,
    normaliseSharedResourceReservationEmail,
    normaliseOptionalPositiveInteger,
    normaliseSharedResourceReservationAmount,
    normaliseDirectReservationPaymentMethod,
    isValidEmailAddress,
    appendAvailabilityPolicyBlockEvents,
    getReservationEventsForListing,
    getDateKeyFromEventDateTime,
    generateGlobalReservationIdentifier,
    getPreferredAppBaseUrl,
    formatDateTimeForMessage,
    createReservationActivityForListing,
    sendPasswordResetEmail,
    writeUserEventLog
  } = deps;

  app.get('/api/private-reservations', requireScopedRole('Manager'), async (req, res) => {
    try {
      const reservations = await getPrivateReservationsForScope(req);
      return res.json({ reservations });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load private reservations.' });
    }
  });

  app.get('/api/private-reservations/guest-users', requireScopedRole('Manager'), async (req, res) => {
    try {
      const guestUsers = await getGuestSiteUsersForClientAccount(req.accessContext.activeClientAccountId);
      return res.json({
        guestUsers: guestUsers.map((row) => {
          const firstName = String(row && row.first_name || '').trim();
          const familyName = String(row && row.family_name || '').trim();
          const fullName = [firstName, familyName].filter(Boolean).join(' ').trim();
          return {
            id: Number(row && row.id || 0),
            email: String(row && row.email || '').trim(),
            firstName,
            familyName,
            displayName: fullName || String(row && row.email || '').trim()
          };
        })
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load guest users.' });
    }
  });

  app.delete('/api/private-reservations/:id', requireScopedRole('Manager'), async (req, res) => {
    const reservationId = Number(req.params.id || 0);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Valid reservation id is required.' });
    }

    try {
      const existingResult = await pool.query(
        `
          SELECT id,
             reservation_identifier,
                 first_name,
                 family_name,
                 email_address,
                 listing_id,
                 reservation_checkin_date::text AS reservation_checkin_date,
                 reservation_checkout_date::text AS reservation_checkout_date,
                 status,
                 client_account_id
          FROM reservation_activity
          WHERE id = $1
            AND client_account_id = $2
          LIMIT 1
        `,
        [reservationId, req.accessContext.activeClientAccountId]
      );

      const existing = existingResult.rows[0] || null;
      if (!existing) {
        return res.status(404).json({ error: 'Private reservation not found.' });
      }

      const listing = await getListingByIdForUser(existing.listing_id, req.accessContext.effectiveOwnerUserId);
      if (!listing || !isListingAllowedByScope(req, listing)) {
        return res.status(404).json({ error: 'Private reservation not found.' });
      }

      await pool.query(
        `
          DELETE FROM reservation_activity
          WHERE id = $1
            AND client_account_id = $2
        `,
        [reservationId, req.accessContext.activeClientAccountId]
      );

      await deleteBookedInChangesForUser(req.accessContext.effectiveOwnerUserId, [{
        listingId: Number(existing.listing_id),
        reservationCheckinDate: existing.reservation_checkin_date,
        reservationCheckoutDate: existing.reservation_checkout_date
      }]);

      const guestEmail = normaliseOptionalEmail(existing.email_address);
      const isProvisional = String(existing.status || '').trim().toLowerCase().startsWith('awaiting_');

      if (isProvisional) {
        await writeUserEventLog({
          actorUserId: Number(req.session && req.session.userId || 0),
          clientAccountId: Number(req.accessContext && req.accessContext.activeClientAccountId || 0),
          eventType: 'provisional_reservation_deleted',
          description: 'Provisional Reservation Deleted - ' + String(existing.reservation_identifier || ''),
          detail: {
            dtg: new Date().toISOString(),
            reservationId: Number(existing.id || 0),
            reservationIdentifier: String(existing.reservation_identifier || ''),
            listingId: Number(existing.listing_id || 0),
            listingName: String(listing && listing.name || ''),
            statusBeforeDelete: String(existing.status || ''),
            arrivalDate: String(existing.reservation_checkin_date || ''),
            departureDate: String(existing.reservation_checkout_date || '')
          }
        });
      }

      if (guestEmail) {
        const guestName = [
          String(existing.first_name || '').trim(),
          String(existing.family_name || '').trim()
        ].filter(Boolean).join(' ').trim() || 'Guest';
        const subject = isProvisional ? 'Provisional Reservation Cancelled' : 'Reservation Cancelled';
        const reservationIdentifier = String(existing.reservation_identifier || '').trim();
        const messageLines = [
          subject,
          '',
          'Guest: ' + guestName,
          'Property: ' + String(listing.property_name || '').trim(),
          'Listing: ' + String(listing.name || '').trim(),
          'Arrival date: ' + String(existing.reservation_checkin_date || '').trim(),
          'Departure date: ' + String(existing.reservation_checkout_date || '').trim()
        ];
        if (isProvisional) {
          if (reservationIdentifier) {
            messageLines.unshift('Reservation ID: ' + reservationIdentifier, '');
          }
          messageLines.push('', 'This accommodation is no longer held for you');
        }
        const textBody = messageLines.join('\n');

        const emailResult = await sendAppEmail({
          to: guestEmail,
          subject,
          textBody
        });
        if (!emailResult.ok) {
          console.warn('Failed to send private reservation cancellation email to guest.', emailResult.error || 'unknown email error');
        }
      }

      return res.json({ deleted: true, id: reservationId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to cancel private reservation.' });
    }
  });

  app.post('/api/private-reservations/:id/confirm-payment', requireScopedRole('Manager'), async (req, res) => {
    const reservationId = Number(req.params.id || 0);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Valid reservation id is required.' });
    }

    try {
      const result = await pool.query(
        `
          SELECT ra.id,
             ra.reservation_identifier,
                 ra.client_account_id,
                 ra.listing_id,
                 ra.reservation_checkin_date::text AS reservation_checkin_date,
                 ra.reservation_checkout_date::text AS reservation_checkout_date,
                 ra.first_name,
                 ra.family_name,
                 ra.email_address,
                 ra.reservation_amount,
                 ra.payment_method,
                 ra.status,
                 ra.created_at,
                 l.name AS listing_name,
                 (ra.reservation_checkout_date - ra.reservation_checkin_date) AS stay_nights
          FROM reservation_activity ra
          JOIN listings l ON l.id = ra.listing_id
          WHERE ra.id = $1
            AND ra.client_account_id = $2
          LIMIT 1
        `,
        [reservationId, req.accessContext.activeClientAccountId]
      );

      const existing = result.rows[0] || null;
      if (!existing) {
        return res.status(404).json({ error: 'Private reservation not found.' });
      }

      const listing = await getListingByIdForUser(existing.listing_id, req.accessContext.effectiveOwnerUserId);
      if (!listing || !isListingAllowedByScope(req, listing)) {
        return res.status(404).json({ error: 'Private reservation not found.' });
      }

      if (String(existing.payment_method || '').trim() !== 'Bank Transfer') {
        return res.status(400).json({ error: 'Only bank transfer reservations can be confirmed.' });
      }

      await ensureGuestSiteUserForClientAccount({
        clientAccountId: req.accessContext.activeClientAccountId,
        ownerUserId: req.accessContext.effectiveOwnerUserId,
        firstName: existing.first_name,
        familyName: existing.family_name,
        email: existing.email_address,
        sourceType: 'private_reservation',
        sourceId: String(existing.id)
      });

      if (String(existing.status || '').trim().toLowerCase() !== 'awaiting_bank_transfer') {
        return res.json({ reservation: mapPrivateReservationRow(existing) });
      }

      const updateResult = await pool.query(
        `
          UPDATE reservation_activity
          SET status = 'confirmed',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING id,
                    reservation_identifier,
                    listing_id,
                    reservation_checkin_date::text AS reservation_checkin_date,
                    reservation_checkout_date::text AS reservation_checkout_date,
                    first_name,
                    family_name,
                    email_address,
                    reservation_amount,
                    payment_method,
                    status,
                    created_at,
                    (reservation_checkout_date - reservation_checkin_date) AS stay_nights
        `,
        [reservationId]
      );

      const updated = updateResult.rows[0] || null;

      await writeUserEventLog({
        actorUserId: Number(req.session && req.session.userId || 0),
        clientAccountId: Number(req.accessContext && req.accessContext.activeClientAccountId || 0),
        eventType: 'reservation_payment_received',
        description: 'Reservation Payment Received - ' + String(updated && updated.reservation_identifier || ''),
        detail: {
          dtg: new Date().toISOString(),
          reservationId: Number(updated && updated.id || 0),
          reservationIdentifier: String(updated && updated.reservation_identifier || ''),
          listingId: Number(updated && updated.listing_id || 0),
          listingName: String(listing && listing.name || ''),
          paymentMethod: String(updated && updated.payment_method || ''),
          amount: Number(updated && updated.reservation_amount || 0),
          previousStatus: String(existing && existing.status || ''),
          currentStatus: String(updated && updated.status || '')
        }
      });

      await writeUserEventLog({
        actorUserId: Number(req.session && req.session.userId || 0),
        clientAccountId: Number(req.accessContext && req.accessContext.activeClientAccountId || 0),
        eventType: 'provisional_reservation_paid',
        description: 'Provisional Reservation Confirmed Paid - ' + String(updated && updated.reservation_identifier || ''),
        detail: {
          dtg: new Date().toISOString(),
          reservationId: Number(updated && updated.id || 0),
          reservationIdentifier: String(updated && updated.reservation_identifier || ''),
          listingId: Number(updated && updated.listing_id || 0),
          listingName: String(listing && listing.name || ''),
          paymentMethod: String(updated && updated.payment_method || ''),
          amount: Number(updated && updated.reservation_amount || 0),
          statusBeforeConfirm: String(existing && existing.status || ''),
          statusAfterConfirm: String(updated && updated.status || '')
        }
      });

      const guestEmail = normaliseOptionalEmail(updated && updated.email_address);
      if (guestEmail) {
        const guestName = [
          String(updated.first_name || '').trim(),
          String(updated.family_name || '').trim()
        ].filter(Boolean).join(' ').trim() || 'Guest';
        const receiptLines = [
          'Reservation Payment Received',
          '',
          'Reservation ID: ' + String(updated.reservation_identifier || '').trim(),
          'Guest: ' + guestName,
          'Property: ' + String(listing.property_name || '').trim(),
          'Listing: ' + String(listing.name || '').trim(),
          'Arrival date: ' + String(updated.reservation_checkin_date || '').trim(),
          'Departure date: ' + String(updated.reservation_checkout_date || '').trim(),
          'Nights: ' + String(Number(updated.stay_nights || 0) || 0),
          'Amount received: ' + Number(updated.reservation_amount || 0).toFixed(2),
          'Payment method: ' + String(updated.payment_method || '').trim(),
          '',
          'Your payment has been received and your reservation is now confirmed.'
        ];

        const receiptEmail = await sendAppEmail({
          to: guestEmail,
          subject: 'Reservation Payment Received',
          textBody: receiptLines.join('\n')
        });

        if (!receiptEmail.ok) {
          console.warn('Failed to send private reservation payment receipt email to guest.', receiptEmail.error || 'unknown email error');
        }
      }

      return res.json({
        reservation: mapPrivateReservationRow({
          ...updated,
          listing_name: existing.listing_name
        })
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to confirm private reservation payment.' });
    }
  });

  app.post('/api/private-reservations', requireScopedRole('Manager'), async (req, res) => {
    const arrivalDate = normaliseDateKey(req.body.arrivalDate);
    const departureDate = normaliseDateKey(req.body.departureDate);
    const listingId = Number(req.body.listingId || (Array.isArray(req.body.listingIds) ? req.body.listingIds[0] : 0));
    const firstName = normaliseSharedResourceReservationText(req.body.firstName, 120);
    const familyName = normaliseSharedResourceReservationText(req.body.familyName, 120);
    const emailAddress = normaliseSharedResourceReservationEmail(req.body.email);
    const guestCount = normaliseOptionalPositiveInteger(req.body.guestCount);
    const reservationAmount = normaliseSharedResourceReservationAmount(req.body.cost);
    const holdHours = normaliseOptionalPositiveInteger(req.body.holdHours);
    const paymentMethod = normaliseDirectReservationPaymentMethod(req.body.paymentMethod);

    if (!arrivalDate || !departureDate || departureDate <= arrivalDate) {
      return res.status(400).json({ error: 'Arrival and departure dates are required and must be valid.' });
    }
    if (!Number.isInteger(listingId) || listingId <= 0) {
      return res.status(400).json({ error: 'Exactly one listing must be selected.' });
    }
    if (!firstName || !familyName) {
      return res.status(400).json({ error: 'First name and family name are required.' });
    }
    if (!emailAddress || !isValidEmailAddress(emailAddress)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 50) {
      return res.status(400).json({ error: 'Guest count is required.' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required.' });
    }
    if (paymentMethod === 'No Charge') {
      if (reservationAmount !== null && reservationAmount < 0) {
        return res.status(400).json({ error: 'Cost cannot be negative.' });
      }
    } else if (reservationAmount === null) {
      return res.status(400).json({ error: 'Cost is required.' });
    }
    if (!Number.isInteger(holdHours) || holdHours <= 0 || holdHours > 720) {
      return res.status(400).json({ error: 'Hold period (hours) is required.' });
    }

    try {
      const listing = await getListingByIdForUser(listingId, req.accessContext.effectiveOwnerUserId);
      if (!listing || !isListingAllowedByScope(req, listing)) {
        return res.status(404).json({ error: 'Listing not found.' });
      }

      const existingEvents = appendAvailabilityPolicyBlockEvents(
        listing,
        await getReservationEventsForListing(listingId)
      );
      const hasConflict = existingEvents.some((event) => {
        const eventStart = getDateKeyFromEventDateTime(event && event.start);
        const eventEnd = getDateKeyFromEventDateTime(event && event.end);
        if (!eventStart || !eventEnd) {
          return false;
        }
        return eventStart < departureDate && eventEnd > arrivalDate;
      });
      if (hasConflict) {
        return res.status(409).json({ error: 'The selected listing is not available for those dates.' });
      }

      const nowMs = Date.now();
      const holdUntilAt = new Date(nowMs + holdHours * 60 * 60 * 1000).toISOString();
      const reservationIdentifier = await generateGlobalReservationIdentifier('private_reservation');
      const reservationAmountValue = paymentMethod === 'No Charge'
        ? 0
        : Number(reservationAmount);
      const baseUrl = getPreferredAppBaseUrl(req) || '';
      const termsUrl = (baseUrl ? (baseUrl + '/guest-terms-and-conditions.html') : '/guest-terms-and-conditions.html');
      const termsStatement = 'By making payment you as The Guest are accepting the terms of The Host for The Reservation as stated in this email.';
      const nextStatus = paymentMethod === 'No Charge'
        ? 'confirmed'
        : paymentMethod === 'Bank Transfer'
          ? 'awaiting_bank_transfer'
          : 'awaiting_online_payment';

      let emailDeliveryWarning = false;
      let emailDeliveryReason = '';

      if (paymentMethod === 'Bank Transfer') {
        const bankResult = await pool.query(
          'SELECT bank_account_name, bank_sort_code, bank_account_number, bank_is_business, bank_iban, bank_bic FROM client_accounts WHERE id = $1 LIMIT 1',
          [req.accessContext.activeClientAccountId]
        );
        const bankRow = bankResult.rows[0] || {};
        const bankAccountName = String(bankRow.bank_account_name || '').trim();
        const bankSortCode = String(bankRow.bank_sort_code || '').trim();
        const bankAccountNumber = String(bankRow.bank_account_number || '').trim();
        const bankIban = String(bankRow.bank_iban || '').trim();
        const bankBic = String(bankRow.bank_bic || '').trim();
        const bankType = bankRow.bank_is_business === true ? 'Business' : 'Personal';
        const dueText = formatDateTimeForMessage(holdUntilAt);

        if (!bankAccountName || !bankSortCode || !bankAccountNumber || !bankIban || !bankBic) {
          return res.status(400).json({ error: 'Bank transfer details must include account name, sort code, account number, IBAN, and BIC.' });
        }

        const textLines = [
          'Payment Request For Accommodation',
          '',
          'Reservation ID: ' + reservationIdentifier,
          'Guest: ' + firstName + ' ' + familyName,
          'Number of guests: ' + String(guestCount),
          'Arrival date: ' + arrivalDate,
          'Departure date: ' + departureDate,
          'Amount payable: ' + reservationAmountValue.toFixed(2),
          'Payment due by: ' + dueText,
          '',
          'Bank details:',
          'Account name: ' + (bankAccountName || 'Not configured'),
          'Sort code: ' + (bankSortCode || 'Not configured'),
          'Account number: ' + (bankAccountNumber || 'Not configured'),
          'IBAN: ' + (bankIban || 'Not configured'),
          'BIC: ' + (bankBic || 'Not configured'),
          'Account type: ' + bankType,
          '',
          termsStatement,
          'Terms and Conditions: ' + termsUrl
        ];

        const emailResult = await sendAppEmail({
          to: emailAddress,
          subject: 'Payment Request For Accommodation',
          textBody: textLines.join('\n')
        });

        if (!emailResult.ok && !String(emailResult.error || '').includes('not configured')) {
          return res.status(502).json({ error: emailResult.error || 'Failed to send payment request email.' });
        }

        if (!emailResult.ok) {
          emailDeliveryReason = String(emailResult.error || '').trim();
          console.warn('Bank transfer email was not sent because email delivery is not configured. Reservation will still be recorded.', emailDeliveryReason);
          emailDeliveryWarning = true;
        }
      }

      const reservation = await createReservationActivityForListing({
        userId: req.accessContext.effectiveOwnerUserId,
        clientAccountId: req.accessContext.activeClientAccountId,
        listingId,
        reservationIdentifier,
        checkinDate: arrivalDate,
        checkoutDate: departureDate,
        firstName,
        familyName,
        emailAddress,
        guestCount,
        reservationAmount: reservationAmountValue,
        holdUntilAt,
        paymentMethod,
        paymentDueAt: holdUntilAt,
        status: nextStatus,
        notes: ''
      });

      // For paid private reservations, ensure the guest can access the site to complete payment.
      // If this email does not already belong to a site user, create the user and send a password-setup link.
      if (paymentMethod !== 'No Charge') {
        const existingGuestSiteUser = await findUserByEmail(emailAddress);
        const guestSiteUser = await ensureGuestSiteUserForClientAccount({
          clientAccountId: req.accessContext.activeClientAccountId,
          ownerUserId: req.accessContext.effectiveOwnerUserId,
          firstName,
          familyName,
          email: emailAddress,
          sourceType: 'private_reservation',
          sourceId: String(reservation.id)
        });

        if (!existingGuestSiteUser && guestSiteUser) {
          let passwordSetupUser = guestSiteUser;
          // Defensive fallback: ensure password_hash is present for reset-token generation.
          if (!passwordSetupUser.password_hash) {
            passwordSetupUser = await findUserByEmail(emailAddress);
          }

          const setupEmailResult = await sendPasswordResetEmail(req, passwordSetupUser);
          if (!setupEmailResult.ok) {
            emailDeliveryReason = String(setupEmailResult.error || '').trim();
            emailDeliveryWarning = true;
          }
        }
      }

      if (paymentMethod === 'No Charge') {
        const noChargeEmail = await sendAppEmail({
          to: emailAddress,
          subject: 'Reservation Confirmation',
          textBody: [
            'Reservation Confirmation',
            '',
            'Reservation ID: ' + reservationIdentifier,
            'Guest: ' + firstName + ' ' + familyName,
            'Arrival date: ' + arrivalDate,
            'Departure date: ' + departureDate,
            'Number of guests: ' + String(guestCount),
            'Property: ' + String(listing.property_name || '').trim(),
            'Listing: ' + String(listing.name || '').trim(),
            '',
            termsStatement,
            'Terms and Conditions: ' + termsUrl
          ].join('\n')
        });

        if (!noChargeEmail.ok) {
          emailDeliveryReason = String(noChargeEmail.error || '').trim();
          emailDeliveryWarning = true;
        }

        await ensureGuestSiteUserForClientAccount({
          clientAccountId: req.accessContext.activeClientAccountId,
          ownerUserId: req.accessContext.effectiveOwnerUserId,
          firstName,
          familyName,
          email: emailAddress,
          sourceType: 'private_reservation',
          sourceId: String(reservation.id)
        });
      } else if (paymentMethod === 'Online Payment') {
        const loginUrl = (baseUrl ? baseUrl.replace(/\/$/, '') : '') + '/index.html';
        const guestName = [firstName, familyName].filter(Boolean).join(' ').trim();
        const onlinePaymentEmail = await sendAppEmail({
          to: emailAddress,
          subject: 'Reservation Request - Online Payment Required',
          textBody: [
            'Reservation Request Submitted',
            '',
            'Reservation ID: ' + reservationIdentifier,
            'Guest: ' + guestName,
            'Arrival date: ' + arrivalDate,
            'Departure date: ' + departureDate,
            'Number of guests: ' + String(guestCount),
            'Property: ' + String(listing.property_name || '').trim(),
            'Listing: ' + String(listing.name || '').trim(),
            'Amount due: ' + reservationAmountValue.toFixed(2),
            '',
            'Please log in to your AutomaticPeople account to complete payment: ',
            loginUrl,
            '',
            'If you are new to the site, please use the separate email you receive to set up your password before you can complete payment.',
            '',
            termsStatement,
            'Terms and Conditions: ' + termsUrl
          ].join('\n')
        });

        if (!onlinePaymentEmail.ok) {
          emailDeliveryReason = String(onlinePaymentEmail.error || '').trim();
          emailDeliveryWarning = true;
        }

        await ensureGuestSiteUserForClientAccount({
          clientAccountId: req.accessContext.activeClientAccountId,
          ownerUserId: req.accessContext.effectiveOwnerUserId,
          firstName,
          familyName,
          email: emailAddress,
          sourceType: 'private_reservation',
          sourceId: String(reservation.id)
        });
      }

      return res.json({
        reservation,
        nextUrl: '/dashboard-private-reservations.html',
        emailDeliveryWarning,
        emailDeliveryReason,
        message: paymentMethod === 'No Charge'
          ? 'Private reservation confirmed and added to the listing calendar.'
          : paymentMethod === 'Bank Transfer'
            ? 'Payment request sent and reservation activity logged.'
            : 'Reservation activity logged. Continue to online payment.'
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create private reservation.' });
    }
  });
}

module.exports = {
  registerWorkflow2PrivateReservationRoutes
};
