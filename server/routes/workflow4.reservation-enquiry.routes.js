'use strict';

function registerWorkflow4ReservationEnquiryRoutes(app, deps) {
  const {
    requireScopedRole,
    getReservationEnquiryLandingPagesForUser,
    hasManagerAssignmentScope,
    isReservationEnquiryLandingPageAllowedByScope,
    getReservationEnquiryLandingPageByIdForUser,
    getListingsForUser,
    isListingAllowedByScope,
    normaliseLandingPageListingUrl,
    createReservationEnquiryLandingPageForUser,
    updateReservationEnquiryLandingPageForUser,
    deleteReservationEnquiryLandingPageForUser,
    getActiveReservationEnquiryLandingPageBySlug,
    buildPublicReservationEnquiryCalendarData,
    getPreferredAppBaseUrl,
    normaliseDateKey,
    normaliseOptionalPositiveInteger,
    buildPublicReservationEnquiryAvailability,
    normaliseSharedResourceReservationText,
    normaliseSharedResourceReservationEmail,
    pool,
    generateGlobalReservationIdentifier,
    getListingByIdForUser,
    createReservationActivityForListing,
    DEBUG_SUPPRESS_PAYMENT_EMAIL_BANK_DETAILS,
    DEBUG_SUPPRESS_PAYMENT_EMAIL_TITLE,
    formatDateTimeForMessage,
    sendAppEmail,
    stripeClient,
    STRIPE_PUBLISHABLE_KEY,
    getUserById,
    isOnlinePaymentAvailableForHostUser,
    setUserStripeConnectState,
    toMinorUnits,
    updateReservationActivityPaymentById,
    normaliseLandingPageSlug,
    finalizeReservationActivityPaymentIntent,
    rankSplitStayOptions,
    ensureGuestSiteUserForClientAccount,
    findUserByEmail,
    sendPasswordResetEmail
  } = deps;

  app.get('/api/reservation-enquiry-landing-pages', requireScopedRole('Staff'), async (req, res) => {
    try {
      let landingPages = await getReservationEnquiryLandingPagesForUser(
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (hasManagerAssignmentScope(req)) {
        landingPages = landingPages.filter((row) => isReservationEnquiryLandingPageAllowedByScope(req, row));
      }
      return res.json({ landingPages });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load reservation enquiry landing pages.' });
    }
  });

  app.get('/api/reservation-enquiry-landing-pages/:id', requireScopedRole('Staff'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid landing page id.' });
    }

    try {
      const landingPage = await getReservationEnquiryLandingPageByIdForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (!landingPage || !isReservationEnquiryLandingPageAllowedByScope(req, landingPage)) {
        return res.status(404).json({ error: 'Landing page not found.' });
      }
      return res.json({ landingPage });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load reservation enquiry landing page.' });
    }
  });

  app.post('/api/reservation-enquiry-landing-pages', requireScopedRole('Manager'), async (req, res) => {
    try {
      const rawListingFilters = Array.isArray(req.body.listingFilters) ? req.body.listingFilters : [];
      if (!rawListingFilters.length) {
        return res.status(400).json({ error: 'Select at least one listing.' });
      }

      const listings = await getListingsForUser(req.accessContext.effectiveOwnerUserId);
      const listingMap = new Map(
        listings.map((listing) => [Number(listing.id), listing])
      );

      const seen = new Set();
      const listingFilters = [];
      for (const row of rawListingFilters) {
        const listingId = Number(row && row.listingId);
        if (!Number.isInteger(listingId) || listingId <= 0 || seen.has(listingId)) {
          return res.status(400).json({ error: 'Selected listings are invalid.' });
        }
        seen.add(listingId);

        const listing = listingMap.get(listingId);
        if (!listing || !isListingAllowedByScope(req, listing)) {
          return res.status(403).json({ error: 'You are not allowed to use one or more selected listings.' });
        }

        const listingUrl = normaliseLandingPageListingUrl(row && row.listingUrl);
        if (listingUrl === null) {
          return res.status(400).json({ error: 'Listing URL must start with http:// or https:// when provided.' });
        }

        listingFilters.push({ listingId, listingUrl: listingUrl || '' });
      }

      const result = await createReservationEnquiryLandingPageForUser({
        userId: req.accessContext.effectiveOwnerUserId,
        clientAccountId: req.accessContext.activeClientAccountId,
        name: req.body.name,
        publicSlug: req.body.publicSlug,
        descriptionHtml: req.body.descriptionHtml,
        notesHtml: req.body.notesHtml,
        listingFilters,
        percentageDiscount: req.body.percentageDiscount,
        paymentMethod: req.body.paymentMethod,
        isActive: req.body.isActive !== false
      });
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      return res.status(201).json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create reservation enquiry landing page.' });
    }
  });

  app.put('/api/reservation-enquiry-landing-pages/:id', requireScopedRole('Manager'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid landing page id.' });
    }

    try {
      const existing = await getReservationEnquiryLandingPageByIdForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (!existing || !isReservationEnquiryLandingPageAllowedByScope(req, existing)) {
        return res.status(404).json({ error: 'Landing page not found.' });
      }

      const rawListingFilters = Array.isArray(req.body.listingFilters) ? req.body.listingFilters : [];
      if (!rawListingFilters.length) {
        return res.status(400).json({ error: 'Select at least one listing.' });
      }

      const listings = await getListingsForUser(req.accessContext.effectiveOwnerUserId);
      const listingMap = new Map(
        listings.map((listing) => [Number(listing.id), listing])
      );

      const seen = new Set();
      const listingFilters = [];
      for (const row of rawListingFilters) {
        const listingId = Number(row && row.listingId);
        if (!Number.isInteger(listingId) || listingId <= 0 || seen.has(listingId)) {
          return res.status(400).json({ error: 'Selected listings are invalid.' });
        }
        seen.add(listingId);

        const listing = listingMap.get(listingId);
        if (!listing || !isListingAllowedByScope(req, listing)) {
          return res.status(403).json({ error: 'You are not allowed to use one or more selected listings.' });
        }

        const listingUrl = normaliseLandingPageListingUrl(row && row.listingUrl);
        if (listingUrl === null) {
          return res.status(400).json({ error: 'Listing URL must start with http:// or https:// when provided.' });
        }

        listingFilters.push({ listingId, listingUrl: listingUrl || '' });
      }

      const result = await updateReservationEnquiryLandingPageForUser({
        id,
        userId: req.accessContext.effectiveOwnerUserId,
        clientAccountId: req.accessContext.activeClientAccountId,
        name: req.body.name,
        publicSlug: req.body.publicSlug,
        descriptionHtml: req.body.descriptionHtml,
        notesHtml: req.body.notesHtml,
        listingFilters,
        percentageDiscount: req.body.percentageDiscount,
        paymentMethod: req.body.paymentMethod,
        isActive: req.body.isActive !== false
      });
      if (result.error === 'Landing page not found.') {
        return res.status(404).json({ error: result.error });
      }
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      return res.json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update reservation enquiry landing page.' });
    }
  });

  app.delete('/api/reservation-enquiry-landing-pages/:id', requireScopedRole('Manager'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid landing page id.' });
    }

    try {
      const existing = await getReservationEnquiryLandingPageByIdForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (!existing || !isReservationEnquiryLandingPageAllowedByScope(req, existing)) {
        return res.status(404).json({ error: 'Landing page not found.' });
      }

      const result = await deleteReservationEnquiryLandingPageForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (result.error) {
        return res.status(404).json({ error: result.error });
      }
      return res.json({ message: 'Landing page deleted.', deletedLandingPageId: result.deletedLandingPageId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete reservation enquiry landing page.' });
    }
  });

  app.get('/api/public/reservation-enquiry-landing-pages/:slug', async (req, res) => {
    try {
      const landingPage = await getActiveReservationEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Reservation enquiry landing page not found.' });
      }

      const listingCalendars = await buildPublicReservationEnquiryCalendarData(landingPage);
      const baseUrl = getPreferredAppBaseUrl(req) || '';
      const publicUrl = (baseUrl ? baseUrl : '') + '/reservation-enquiry.html?landingPage=' + encodeURIComponent(String(landingPage.public_slug || ''));
      const termsUrl = (baseUrl ? baseUrl : '') + '/guest-terms-and-conditions.html';

      return res.json({
        landingPage: {
          id: landingPage.id,
          title: landingPage.name,
          description_html: landingPage.description_html,
          notes_html: landingPage.notes_html,
          public_slug: landingPage.public_slug,
          payment_method: landingPage.payment_method,
          percentage_discount: Number(landingPage.percentage_discount || 0),
          show_discount_column: Number(landingPage.percentage_discount || 0) > 0,
          public_url: publicUrl,
          terms_url: termsUrl,
          listing_calendars: listingCalendars
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load reservation enquiry landing page.' });
    }
  });

  app.post('/api/public/reservation-enquiry-landing-pages/:slug/check-availability', async (req, res) => {
    const arrivalDate = normaliseDateKey(req.body.arrivalDate);
    const departureDate = normaliseDateKey(req.body.departureDate);
    const guestCount = normaliseOptionalPositiveInteger(req.body.guestCount);

    if (!arrivalDate || !departureDate || departureDate <= arrivalDate) {
      return res.status(400).json({ error: 'Requested Arrival Date and Requested Departure Date are required.' });
    }
    if (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 50) {
      return res.status(400).json({ error: 'Number of Guests is required.' });
    }

    try {
      const landingPage = await getActiveReservationEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Reservation enquiry landing page not found.' });
      }

      const availability = await buildPublicReservationEnquiryAvailability(landingPage, arrivalDate, departureDate, guestCount);
      return res.json({
        paymentMethod: availability.paymentMethod,
        discountPct: availability.discountPct,
        options: availability.options || []
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to check availability.' });
    }
  });

  app.post('/api/public/reservation-enquiry-landing-pages/:slug/bank-transfer-submit', async (req, res) => {
    const arrivalDate = normaliseDateKey(req.body.arrivalDate);
    const departureDate = normaliseDateKey(req.body.departureDate);
    const guestCount = normaliseOptionalPositiveInteger(req.body.guestCount);
    const optionKey = String(req.body.optionKey || '').trim();
    const firstName = normaliseSharedResourceReservationText(req.body.firstName, 120);
    const familyName = normaliseSharedResourceReservationText(req.body.familyName, 120);
    const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
    const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);

    if (!arrivalDate || !departureDate || departureDate <= arrivalDate) {
      return res.status(400).json({ error: 'Requested Arrival Date and Requested Departure Date are required.' });
    }
    if (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 50) {
      return res.status(400).json({ error: 'Number of Guests is required.' });
    }
    if (!optionKey) {
      return res.status(400).json({ error: 'Exactly one reservation option must be selected.' });
    }
    if (!firstName || !familyName || !emailAddress || !telephone) {
      return res.status(400).json({ error: 'First name, family name, email address and telephone are required.' });
    }

    try {
      const landingPage = await getActiveReservationEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Reservation enquiry landing page not found.' });
      }
      if (String(landingPage.payment_method || '') !== 'bank_transfer') {
        return res.status(400).json({ error: 'This landing page is not configured for bank transfer.' });
      }

      const availability = await buildPublicReservationEnquiryAvailability(landingPage, arrivalDate, departureDate, guestCount);
      const selectedOption = (availability.options || []).find((option) => String(option.key || '') === optionKey) || null;
      if (!selectedOption) {
        return res.status(409).json({ error: 'The selected reservation option is no longer available.' });
      }

      const bankResult = await pool.query(
        'SELECT bank_account_name, bank_sort_code, bank_account_number, bank_is_business, bank_iban, bank_bic FROM client_accounts WHERE id = $1 LIMIT 1',
        [landingPage.client_account_id]
      );
      const bankRow = bankResult.rows[0] || {};
      const bankAccountName = String(bankRow.bank_account_name || '').trim();
      const bankSortCode = String(bankRow.bank_sort_code || '').trim();
      const bankAccountNumber = String(bankRow.bank_account_number || '').trim();
      const bankIban = String(bankRow.bank_iban || '').trim();
      const bankBic = String(bankRow.bank_bic || '').trim();
      const bankType = bankRow.bank_is_business === true ? 'Business' : 'Personal';
      if (!bankAccountName || !bankSortCode || !bankAccountNumber || !bankIban || !bankBic) {
        return res.status(400).json({ error: 'Bank transfer details must include account name, sort code, account number, IBAN, and BIC.' });
      }

      const holdUntilAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const reservationRows = [];
      for (const segment of (selectedOption.segments || [])) {
        const reservationIdentifier = await generateGlobalReservationIdentifier('private_reservation');
        const listing = await getListingByIdForUser(Number(segment.listingId), Number(landingPage.user_id || 0));
        if (!listing) {
          return res.status(404).json({ error: 'One of the selected listings could not be found.' });
        }

        const reservation = await createReservationActivityForListing({
          userId: Number(landingPage.user_id || 0),
          clientAccountId: Number(landingPage.client_account_id || 0),
          listingId: Number(segment.listingId),
          reservationIdentifier,
          checkinDate: segment.arrivalDate,
          checkoutDate: segment.departureDate,
          firstName,
          familyName,
          emailAddress,
          guestCount,
          reservationAmount: Number(segment.discountedPrice || segment.price || 0),
          holdUntilAt,
          paymentMethod: 'Bank Transfer',
          paymentDueAt: holdUntilAt,
          status: 'awaiting_bank_transfer',
          notes: 'Reservation enquiry landing page: ' + String(landingPage.public_slug || '')
        });

        reservationRows.push({ reservation, segment, listing });
      }

      const totalAmount = Number(availability.discountPct || 0) > 0
        ? Number(selectedOption.discountedTotalPrice || 0)
        : Number(selectedOption.totalPrice || 0);
      const baseUrl = getPreferredAppBaseUrl(req) || '';
      const termsUrl = (baseUrl ? baseUrl : '') + '/guest-terms-and-conditions.html';
      const debugSuppressTermsAndConditions = DEBUG_SUPPRESS_PAYMENT_EMAIL_BANK_DETAILS || DEBUG_SUPPRESS_PAYMENT_EMAIL_TITLE;
      const paymentEmailSubject = DEBUG_SUPPRESS_PAYMENT_EMAIL_TITLE
        ? 'Reservation Enquiry Received'
        : 'Payment Request For Accommodation';
      const textLines = [
        paymentEmailSubject,
        '',
        'Guest: ' + firstName + ' ' + familyName,
        'Number of guests: ' + String(guestCount),
        'Amount payable: ' + totalAmount.toFixed(2),
        'Payment due by: ' + formatDateTimeForMessage(holdUntilAt),
        '',
        'Stay details:'
      ];

      reservationRows.forEach((row) => {
        textLines.push(
          '- ' + String(row.listing.property_name || '').trim() + ' / ' + String(row.listing.name || '').trim()
          + ' | ' + String(row.segment.arrivalDate || '') + ' to ' + String(row.segment.departureDate || '')
          + ' | Amount: ' + Number(row.segment.discountedPrice || row.segment.price || 0).toFixed(2)
        );
      });

      if (DEBUG_SUPPRESS_PAYMENT_EMAIL_BANK_DETAILS) {
        textLines.push(
          '',
          'Payment instructions are temporarily omitted for deliverability debugging.'
        );
      } else {
        textLines.push(
          '',
          'Bank details:',
          'Account name: ' + bankAccountName,
          'Sort code: ' + bankSortCode,
          'Account number: ' + bankAccountNumber,
          'IBAN: ' + bankIban,
          'BIC: ' + bankBic,
          'Account type: ' + bankType,
          ''
        );

        if (!debugSuppressTermsAndConditions) {
          textLines.push(
            'By making payment you as The Guest are accepting the terms of The Host for The Reservation as stated in this email.',
            'Terms and Conditions: ' + termsUrl
          );
        }
      }

      let emailDeliveryWarning = false;
      let emailDeliveryReason = '';
      const logContext = {
        reservationEnquiry: true,
        landingPageSlug: req.params.slug,
        guestEmail: emailAddress,
        guestName: firstName + ' ' + familyName,
        reservationIdentifiers: reservationRows.map((row) => String(row.reservation && row.reservation.reservation_identifier || '')).filter(Boolean),
        totalAmount: totalAmount,
        debugSuppressBankDetails: DEBUG_SUPPRESS_PAYMENT_EMAIL_BANK_DETAILS,
        debugSuppressPaymentTitle: DEBUG_SUPPRESS_PAYMENT_EMAIL_TITLE,
        debugSuppressTermsAndConditions,
        timestamp: new Date().toISOString()
      };

      const emailResult = await sendAppEmail({
        to: emailAddress,
        subject: paymentEmailSubject,
        textBody: textLines.join('\n')
      });

      if (emailResult.ok) {
        console.log('[ReservationEnquiry] Email sent successfully', {
          ...logContext,
          postmarkMessageId: emailResult.messageId,
          postmarkResponse: emailResult.postmarkResponse
        });
      } else if (!String(emailResult.error || '').includes('not configured')) {
        console.error('[ReservationEnquiry] Email send failed (hard error)', {
          ...logContext,
          error: emailResult.error,
          postmarkStatusCode: emailResult.postmarkStatusCode,
          postmarkResponse: emailResult.postmarkResponse,
          exception: emailResult.exception
        });
        return res.status(502).json({ error: emailResult.error || 'Failed to send payment request email.' });
      } else {
        emailDeliveryWarning = true;
        emailDeliveryReason = String(emailResult.error || '').trim();
        console.warn('[ReservationEnquiry] Email delivery not configured', {
          ...logContext,
          warning: emailDeliveryReason
        });
      }

      if (!emailResult.ok && String(emailResult.error || '').includes('not configured')) {
        emailDeliveryWarning = true;
        emailDeliveryReason = String(emailResult.error || '').trim();
      }

      // Mirror Workflow 2 behavior for paid reservations: ensure guest account exists and
      // send password-setup email for first-time site users.
      const existingGuestSiteUser = await findUserByEmail(emailAddress);
      const firstReservation = reservationRows[0] && reservationRows[0].reservation
        ? reservationRows[0].reservation
        : null;
      const guestSiteUser = await ensureGuestSiteUserForClientAccount({
        clientAccountId: Number(landingPage.client_account_id || 0),
        ownerUserId: Number(landingPage.user_id || 0),
        firstName,
        familyName,
        email: emailAddress,
        sourceType: 'private_reservation',
        sourceId: String(firstReservation && firstReservation.id || '')
      });

      if (!existingGuestSiteUser && guestSiteUser) {
        let passwordSetupUser = guestSiteUser;
        if (!passwordSetupUser.password_hash) {
          passwordSetupUser = await findUserByEmail(emailAddress);
        }

        const setupEmailResult = await sendPasswordResetEmail(req, passwordSetupUser);
        if (!setupEmailResult.ok) {
          emailDeliveryWarning = true;
          if (!emailDeliveryReason) {
            emailDeliveryReason = String(setupEmailResult.error || '').trim();
          }
        }
      }

      return res.status(201).json({
        message: 'Payment request sent and reservation enquiry logged.',
        reservationIdentifiers: reservationRows.map((row) => String(row.reservation && row.reservation.reservation_identifier || '')).filter(Boolean),
        bankAccount: {
          accountName: bankAccountName,
          sortCode: bankSortCode,
          accountNumber: bankAccountNumber,
          iban: bankIban,
          bic: bankBic,
          accountType: bankType
        },
        emailDeliveryWarning,
        emailDeliveryReason
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to submit bank transfer reservation enquiry.' });
    }
  });

  app.post('/api/public/reservation-enquiry-landing-pages/:slug/online-payment/prepare', async (req, res) => {
    if (!stripeClient || !STRIPE_PUBLISHABLE_KEY) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.' });
    }

    const arrivalDate = normaliseDateKey(req.body.arrivalDate);
    const departureDate = normaliseDateKey(req.body.departureDate);
    const guestCount = normaliseOptionalPositiveInteger(req.body.guestCount);
    const optionKey = String(req.body.optionKey || '').trim();
    const firstName = normaliseSharedResourceReservationText(req.body.firstName, 120);
    const familyName = normaliseSharedResourceReservationText(req.body.familyName, 120);
    const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
    const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);

    if (!arrivalDate || !departureDate || departureDate <= arrivalDate) {
      return res.status(400).json({ error: 'Requested Arrival Date and Requested Departure Date are required.' });
    }
    if (!Number.isInteger(guestCount) || guestCount <= 0 || guestCount > 50) {
      return res.status(400).json({ error: 'Number of Guests is required.' });
    }
    if (!optionKey) {
      return res.status(400).json({ error: 'Exactly one reservation option must be selected.' });
    }
    if (!firstName || !familyName || !emailAddress || !telephone) {
      return res.status(400).json({ error: 'First name, family name, email address and telephone are required.' });
    }

    try {
      const landingPage = await getActiveReservationEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Reservation enquiry landing page not found.' });
      }
      if (String(landingPage.payment_method || '') !== 'online') {
        return res.status(400).json({ error: 'This landing page is not configured for online payment.' });
      }

      const hostUser = await getUserById(Number(landingPage.user_id || 0));
      if (!hostUser || !hostUser.stripe_account_id) {
        return res.status(400).json({ error: 'Host Stripe account is not connected yet.' });
      }
      if (!isOnlinePaymentAvailableForHostUser(hostUser)) {
        return res.status(400).json({ error: 'Host online payment is currently unavailable.' });
      }

      const availability = await buildPublicReservationEnquiryAvailability(landingPage, arrivalDate, departureDate, guestCount);
      const selectedOption = (availability.options || []).find((option) => String(option.key || '') === optionKey) || null;
      if (!selectedOption) {
        return res.status(409).json({ error: 'The selected reservation option is no longer available.' });
      }

      const stripeAccount = await stripeClient.accounts.retrieve(String(hostUser.stripe_account_id));
      await setUserStripeConnectState(hostUser.id, {
        stripe_account_id: stripeAccount.id,
        stripe_onboarding_complete: stripeAccount.details_submitted === true,
        stripe_charges_enabled: stripeAccount.charges_enabled === true,
        stripe_payouts_enabled: stripeAccount.payouts_enabled === true
      });
      if (stripeAccount.charges_enabled !== true || stripeAccount.payouts_enabled !== true) {
        return res.status(400).json({ error: 'Host Stripe account onboarding is incomplete.' });
      }

      const payableAmount = Number(availability.discountPct || 0) > 0
        ? Number(selectedOption.discountedTotalPrice || 0)
        : Number(selectedOption.totalPrice || 0);
      if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
        return res.status(400).json({ error: 'A valid reservation amount is required for online payment.' });
      }

      const holdUntilAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const reservationRows = [];
      for (const segment of (selectedOption.segments || [])) {
        const reservationIdentifier = await generateGlobalReservationIdentifier('private_reservation');
        const reservation = await createReservationActivityForListing({
          userId: Number(landingPage.user_id || 0),
          clientAccountId: Number(landingPage.client_account_id || 0),
          listingId: Number(segment.listingId),
          reservationIdentifier,
          checkinDate: segment.arrivalDate,
          checkoutDate: segment.departureDate,
          firstName,
          familyName,
          emailAddress,
          guestCount,
          reservationAmount: Number(segment.discountedPrice || segment.price || 0),
          holdUntilAt,
          paymentMethod: 'Online Payment',
          paymentDueAt: holdUntilAt,
          status: 'awaiting_online_payment',
          notes: 'Reservation enquiry landing page: ' + String(landingPage.public_slug || '')
        });
        reservationRows.push(reservation);
      }

      const paymentIntent = await stripeClient.paymentIntents.create(
        {
          amount: toMinorUnits(payableAmount),
          currency: 'gbp',
          automatic_payment_methods: { enabled: true },
          transfer_data: {
            destination: String(stripeAccount.id)
          },
          metadata: {
            reservation_type: 'reservation_enquiry_landing_page',
            landing_page_slug: String(landingPage.public_slug || ''),
            host_user_id: String(landingPage.user_id || ''),
            first_reservation_id: String(reservationRows[0] && reservationRows[0].id || ''),
            first_reservation_identifier: String(reservationRows[0] && reservationRows[0].reservation_identifier || '')
          },
          receipt_email: emailAddress
        },
        {
          idempotencyKey: 'reservation-enquiry-' + String((reservationRows[0] && reservationRows[0].reservation_identifier) || Date.now())
        }
      );

      console.log('[StripeDiagnostics][ReservationEnquiryPrepare]', {
        landingPageSlug: String(landingPage.public_slug || ''),
        paymentIntentId: String(paymentIntent.id || ''),
        paymentIntentStatus: String(paymentIntent.status || ''),
        hostStripeAccountId: String(stripeAccount.id || ''),
        reservationIdentifiers: reservationRows.map((row) => String(row && row.reservation_identifier || '')).filter(Boolean),
        guestEmail: emailAddress
      });

      await Promise.all(reservationRows.map((reservation) => updateReservationActivityPaymentById(reservation.id, {
        paymentProvider: 'stripe',
        paymentIntentId: paymentIntent.id,
        paymentStatus: String(paymentIntent.status || '').toLowerCase(),
        paymentCurrency: String(paymentIntent.currency || 'gbp').toLowerCase(),
        paymentAmountMinor: Number.isInteger(paymentIntent.amount) ? paymentIntent.amount : toMinorUnits(payableAmount),
        paymentLastError: ''
      })));

      // Mirror Workflow 2 behavior for paid reservations: ensure guest account exists and
      // send password-setup email for first-time site users.
      let accountEmailDeliveryWarning = false;
      let accountEmailDeliveryReason = '';
      const existingGuestSiteUser = await findUserByEmail(emailAddress);
      const firstReservation = reservationRows[0] || null;
      const guestSiteUser = await ensureGuestSiteUserForClientAccount({
        clientAccountId: Number(landingPage.client_account_id || 0),
        ownerUserId: Number(landingPage.user_id || 0),
        firstName,
        familyName,
        email: emailAddress,
        sourceType: 'private_reservation',
        sourceId: String(firstReservation && firstReservation.id || '')
      });

      if (!existingGuestSiteUser && guestSiteUser) {
        let passwordSetupUser = guestSiteUser;
        if (!passwordSetupUser.password_hash) {
          passwordSetupUser = await findUserByEmail(emailAddress);
        }

        const setupEmailResult = await sendPasswordResetEmail(req, passwordSetupUser);
        if (!setupEmailResult.ok) {
          accountEmailDeliveryWarning = true;
          accountEmailDeliveryReason = String(setupEmailResult.error || '').trim();
        }
      }

      return res.status(201).json({
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        reservationIdentifiers: reservationRows.map((row) => String(row && row.reservation_identifier || '')).filter(Boolean),
        payableAmount,
        accountEmailDeliveryWarning,
        accountEmailDeliveryReason
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to prepare online payment.' });
    }
  });

  app.post('/api/public/reservation-enquiry-landing-pages/:slug/online-payment/finalize', async (req, res) => {
    if (!stripeClient) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.' });
    }

    const slug = normaliseLandingPageSlug(req.params.slug);
    const paymentIntentId = String(req.body && req.body.paymentIntentId || '').trim();
    if (!slug) {
      return res.status(400).json({ error: 'Invalid landing page slug.' });
    }
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent id is required.' });
    }

    try {
      const paymentIntent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
      if (!paymentIntent || !paymentIntent.id) {
        return res.status(404).json({ error: 'Payment intent was not found.' });
      }

      console.log('[StripeDiagnostics][ReservationEnquiryFinalize][StripeRetrieved]', {
        landingPageSlug: slug,
        paymentIntentId: String(paymentIntent.id || ''),
        status: String(paymentIntent.status || ''),
        currency: String(paymentIntent.currency || ''),
        amount: Number.isInteger(paymentIntent.amount) ? paymentIntent.amount : null,
        amountReceived: Number.isInteger(paymentIntent.amount_received) ? paymentIntent.amount_received : null,
        receiptEmail: String(paymentIntent.receipt_email || ''),
        metadata: paymentIntent.metadata || {}
      });

      const paymentIntentSlug = normaliseLandingPageSlug(paymentIntent.metadata && paymentIntent.metadata.landing_page_slug);
      if (paymentIntentSlug && paymentIntentSlug !== slug) {
        return res.status(403).json({ error: 'Payment intent does not match this landing page.' });
      }

      const finalized = await finalizeReservationActivityPaymentIntent(paymentIntent, {
        source: 'public-finalize-endpoint'
      });

      console.log('[StripeDiagnostics][ReservationEnquiryFinalize][DBFinalize]', {
        landingPageSlug: slug,
        paymentIntentId: String(paymentIntent.id || ''),
        found: finalized && finalized.found === true,
        confirmed: finalized && finalized.confirmed === true,
        alreadyConfirmed: finalized && finalized.alreadyConfirmed === true,
        reservationIdentifiers: finalized && Array.isArray(finalized.reservationIdentifiers) ? finalized.reservationIdentifiers : [],
        emailSent: finalized && finalized.emailSent === true,
        emailRecipient: String(finalized && finalized.emailRecipient || ''),
        emailError: String(finalized && finalized.emailError || '')
      });

      if (!finalized || !finalized.found) {
        return res.status(404).json({ error: 'No reservation records found for this payment intent.' });
      }
      if (finalized.confirmed !== true) {
        return res.status(409).json({
          error: 'Payment has not completed yet.',
          paymentStatus: String(finalized.paymentStatus || '')
        });
      }

      return res.json({
        message: 'Reservation payment finalized.',
        reservationIdentifiers: finalized.reservationIdentifiers || [],
        paymentStatus: String(finalized.paymentStatus || ''),
        emailSent: finalized.emailSent === true,
        emailError: String(finalized.emailError || ''),
        emailRecipient: String(finalized.emailRecipient || '')
      });
    } catch (err) {
      console.error('[Finalize] Reservation enquiry payment finalization failed', {
        paymentIntentId,
        error: String(err && err.message || err)
      });
      return res.status(500).json({ error: 'Failed to finalize reservation payment.' });
    }
  });

  app.post('/api/public/reservation-enquiry/split-stay/rank', async (req, res) => {
    const options = Array.isArray(req.body && req.body.options) ? req.body.options : [];
    if (!options.length) {
      return res.status(400).json({ error: 'A non-empty options array is required.' });
    }

    const preferredListingId = Number(req.body && req.body.preferredListingId || 0);

    try {
      const ranked = rankSplitStayOptions(options, preferredListingId);
      return res.json({ rankedOptions: ranked });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to rank split-stay options.' });
    }
  });
}

module.exports = {
  registerWorkflow4ReservationEnquiryRoutes
};
