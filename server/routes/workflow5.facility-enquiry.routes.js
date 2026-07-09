'use strict';

function registerWorkflow5FacilityEnquiryRoutes(app, deps) {
  const {
    requireScopedRole,
    getFacilityEnquiryLandingPagesForUser,
    getFacilityEnquiryLandingPageByIdForUser,
    isFacilityEnquiryLandingPageAllowedByScope,
    createFacilityEnquiryLandingPageForUser,
    updateFacilityEnquiryLandingPageForUser,
    deleteFacilityEnquiryLandingPageForUser,
    getActiveFacilityEnquiryLandingPageBySlug,
    getPreferredAppBaseUrl,
    getSharedResourceByIdPublic,
    getUserById,
    isOnlinePaymentAvailableForHostUser,
    normaliseDateKey,
    parseLocalDateTime,
    normaliseSharedResourceMaxAdvanceBookingDays,
    getSharedResourceReservationsByResourceId,
    normaliseSharedResourceMaxUnits,
    findCapacityConflictPeriod,
    findAvailablePeriods,
    formatDateTimeForMessage,
    normaliseSharedResourceReservationText,
    normaliseSharedResourceReservationEmail,
    normaliseSharedResourceReservationAmount,
    getDateKeyFromEventDateTime,
    getSharedResourceReservationListingId,
    generateGlobalReservationIdentifier,
    createSharedResourceReservation,
    htmlToPlainText,
    pool,
    sendAppEmail,
    stripeClient,
    STRIPE_PUBLISHABLE_KEY,
    setUserStripeConnectState,
    toMinorUnits,
    updateSharedResourceReservationPaymentById
  } = deps;

  app.get('/api/facility-enquiry-landing-pages', requireScopedRole('Staff'), async (req, res) => {
    try {
      let landingPages = await getFacilityEnquiryLandingPagesForUser(
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      landingPages = landingPages.filter((row) => isFacilityEnquiryLandingPageAllowedByScope(req, row));
      return res.json({ landingPages });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load facility enquiry landing pages.' });
    }
  });

  app.get('/api/facility-enquiry-landing-pages/:id', requireScopedRole('Staff'), async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid landing page id.' });
    }

    try {
      const landingPage = await getFacilityEnquiryLandingPageByIdForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (!landingPage || !isFacilityEnquiryLandingPageAllowedByScope(req, landingPage)) {
        return res.status(404).json({ error: 'Landing page not found.' });
      }
      return res.json({ landingPage });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load facility enquiry landing page.' });
    }
  });

  app.post('/api/facility-enquiry-landing-pages', requireScopedRole('Manager'), async (req, res) => {
    try {
      const result = await createFacilityEnquiryLandingPageForUser({
        userId: req.accessContext.effectiveOwnerUserId,
        clientAccountId: req.accessContext.activeClientAccountId,
        name: req.body.name,
        publicSlug: req.body.publicSlug,
        descriptionHtml: req.body.descriptionHtml,
        notesHtml: req.body.notesHtml,
        paymentMethod: req.body.paymentMethod,
        sharedResourceId: req.body.sharedResourceId,
        isActive: req.body.isActive !== false
      });
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      return res.status(201).json(result);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create facility enquiry landing page.' });
    }
  });

  app.put('/api/facility-enquiry-landing-pages/:id', requireScopedRole('Manager'), async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid landing page id.' });
    }

    try {
      const existing = await getFacilityEnquiryLandingPageByIdForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (!existing || !isFacilityEnquiryLandingPageAllowedByScope(req, existing)) {
        return res.status(404).json({ error: 'Landing page not found.' });
      }

      const result = await updateFacilityEnquiryLandingPageForUser({
        id,
        userId: req.accessContext.effectiveOwnerUserId,
        clientAccountId: req.accessContext.activeClientAccountId,
        name: req.body.name,
        publicSlug: req.body.publicSlug,
        descriptionHtml: req.body.descriptionHtml,
        notesHtml: req.body.notesHtml,
        paymentMethod: req.body.paymentMethod,
        sharedResourceId: req.body.sharedResourceId,
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
      return res.status(500).json({ error: 'Failed to update facility enquiry landing page.' });
    }
  });

  app.delete('/api/facility-enquiry-landing-pages/:id', requireScopedRole('Manager'), async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid landing page id.' });
    }

    try {
      const existing = await getFacilityEnquiryLandingPageByIdForUser(
        id,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId
      );
      if (!existing || !isFacilityEnquiryLandingPageAllowedByScope(req, existing)) {
        return res.status(404).json({ error: 'Landing page not found.' });
      }

      const result = await deleteFacilityEnquiryLandingPageForUser(
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
      return res.status(500).json({ error: 'Failed to delete facility enquiry landing page.' });
    }
  });

  app.get('/api/public/facility-enquiry-landing-pages/:slug', async (req, res) => {
    try {
      const landingPage = await getActiveFacilityEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Facility enquiry landing page not found.' });
      }

      const resource = await getSharedResourceByIdPublic(Number(landingPage.shared_resource_id || 0));
      if (!resource) {
        return res.status(404).json({ error: 'Facility not found for this landing page.' });
      }

      const hostUser = await getUserById(Number(resource.user_id || 0));
      const onlinePaymentAvailable = resource.online_payment === true && isOnlinePaymentAvailableForHostUser(hostUser);
      const baseUrl = getPreferredAppBaseUrl(req) || '';
      const publicUrl = (baseUrl ? baseUrl : '') + '/resource-booking.html?facilityLandingPage=' + encodeURIComponent(String(landingPage.public_slug || ''));
      const termsUrl = (baseUrl ? baseUrl : '') + '/guest-terms-and-conditions.html';

      return res.json({
        landingPage: {
          id: landingPage.id,
          title: landingPage.name,
          description_html: landingPage.description_html,
          notes_html: landingPage.notes_html,
          public_slug: landingPage.public_slug,
          payment_method: landingPage.payment_method,
          public_url: publicUrl,
          terms_url: termsUrl,
          facility: {
            id: Number(resource.id || 0),
            short_description: String(resource.short_description || ''),
            full_description_html: String(resource.full_description_html || ''),
            resource_type: String(resource.resource_type || ''),
            max_units: Number(resource.max_units || 1),
            max_days_advance_booking: Number(resource.max_days_advance_booking || 365),
            bank_transfer: resource.bank_transfer === true,
            online_payment: resource.online_payment === true,
            online_payment_available: onlinePaymentAvailable
          }
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load facility enquiry landing page.' });
    }
  });

  app.post('/api/public/facility-enquiry-landing-pages/:slug/check-availability', async (req, res) => {
    const requestedStartAtRaw = String(req.body.requestedStartAt || '').trim();
    const requestedEndAtRaw = String(req.body.requestedEndAt || '').trim();
    let requestedStartAt = new Date(requestedStartAtRaw);
    let requestedEndAt = new Date(requestedEndAtRaw);

    if (Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime())) {
      requestedStartAt = parseLocalDateTime(req.body.requestedStartDate, req.body.requestedStartTime);
      requestedEndAt = parseLocalDateTime(req.body.requestedEndDate, req.body.requestedEndTime);
    }

    const checkinDate = normaliseDateKey(req.body.checkinDate) || getDateKeyFromEventDateTime(requestedStartAtRaw);
    const checkoutDate = normaliseDateKey(req.body.checkoutDate) || getDateKeyFromEventDateTime(requestedEndAtRaw);

    if (!requestedStartAt || !requestedEndAt || Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime())) {
      return res.status(400).json({ error: 'Requested start and end date-times are required.' });
    }
    if (requestedEndAt.getTime() <= requestedStartAt.getTime()) {
      return res.status(400).json({ error: 'Requested end must be after requested start.' });
    }
    if (!checkinDate || !checkoutDate) {
      return res.status(400).json({ error: 'Checkin and checkout dates are required.' });
    }

    try {
      const landingPage = await getActiveFacilityEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Facility enquiry landing page not found.' });
      }

      const resource = await getSharedResourceByIdPublic(Number(landingPage.shared_resource_id || 0));
      if (!resource) {
        return res.status(404).json({ error: 'Facility not found for this landing page.' });
      }

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const maxDays = normaliseSharedResourceMaxAdvanceBookingDays(resource.max_days_advance_booking) || 365;
      const latestAllowed = new Date(now.getTime());
      latestAllowed.setDate(latestAllowed.getDate() + maxDays);
      const checkinTime = new Date(checkinDate + 'T00:00:00');
      if (checkinTime.getTime() > latestAllowed.getTime()) {
        return res.status(400).json({ error: 'Requested checkin exceeds max days advance booking.' });
      }

      const existingReservations = await getSharedResourceReservationsByResourceId(Number(resource.id));
      const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
      const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
      const requestedSpaces = resource.resource_type === 'parking'
        ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
        : 1;

      const conflict = findCapacityConflictPeriod(
        existingReservations,
        requestedStartAt.toISOString(),
        requestedEndAt.toISOString(),
        requestedSpaces,
        maxUnits
      );

      if (conflict) {
        const availablePeriods = findAvailablePeriods(
          existingReservations,
          requestedStartAt.toISOString(),
          requestedEndAt.toISOString(),
          requestedSpaces,
          maxUnits
        );

        let errorMessage;
        if (availablePeriods.length === 0) {
          errorMessage = 'No availability within your requested window.';
        } else {
          const periodList = availablePeriods
            .map((p) => formatDateTimeForMessage(p.start) + ' to ' + formatDateTimeForMessage(p.end))
            .join(', ');
          errorMessage = 'Not fully available for your requested dates. Available periods within your window: ' + periodList + '.';
        }

        return res.status(409).json({ error: errorMessage });
      }

      return res.json({
        message: 'Availability Confirmed',
        paymentMethod: String(landingPage.payment_method || ''),
        sharedResourceId: Number(resource.id || 0)
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to check facility availability.' });
    }
  });

  app.post('/api/public/facility-enquiry-landing-pages/:slug/bank-transfer-submit', async (req, res) => {
    const requestedStartAtRaw = String(req.body.requestedStartAt || '').trim();
    const requestedEndAtRaw = String(req.body.requestedEndAt || '').trim();
    const requestedStartAt = new Date(requestedStartAtRaw);
    const requestedEndAt = new Date(requestedEndAtRaw);

    if (Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime()) || requestedEndAt.getTime() <= requestedStartAt.getTime()) {
      return res.status(400).json({ error: 'Requested end must be after requested start.' });
    }

    const checkinDate = normaliseDateKey(req.body.checkinDate) || getDateKeyFromEventDateTime(requestedStartAtRaw);
    const checkoutDate = normaliseDateKey(req.body.checkoutDate) || getDateKeyFromEventDateTime(requestedEndAtRaw);
    if (!checkinDate || !checkoutDate) {
      return res.status(400).json({ error: 'Checkin and checkout dates are required.' });
    }

    const firstName = normaliseSharedResourceReservationText(req.body.firstName, 100);
    const familyName = normaliseSharedResourceReservationText(req.body.familyName, 100);
    const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
    const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);
    const vehicleRegistration = normaliseSharedResourceReservationText(req.body.vehicleRegistration, 60) || '';
    const reservationAmount = normaliseSharedResourceReservationAmount(req.body.reservationAmount);

    if (!firstName || !familyName || !emailAddress || !telephone) {
      return res.status(400).json({ error: 'First name, family name, email address and telephone are required.' });
    }

    try {
      const landingPage = await getActiveFacilityEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Facility enquiry landing page not found.' });
      }
      if (String(landingPage.payment_method || '') !== 'bank_transfer') {
        return res.status(400).json({ error: 'This landing page is not configured for bank transfer.' });
      }

      const resource = await getSharedResourceByIdPublic(Number(landingPage.shared_resource_id || 0));
      if (!resource) {
        return res.status(404).json({ error: 'Facility not found for this landing page.' });
      }
      if (resource.bank_transfer !== true) {
        return res.status(400).json({ error: 'Bank transfer is not enabled for this facility.' });
      }

      const existingReservations = await getSharedResourceReservationsByResourceId(Number(resource.id));
      const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
      const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
      const requestedSpaces = resource.resource_type === 'parking'
        ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
        : 1;

      const conflict = findCapacityConflictPeriod(
        existingReservations,
        requestedStartAt.toISOString(),
        requestedEndAt.toISOString(),
        requestedSpaces,
        maxUnits
      );
      if (conflict) {
        return res.status(409).json({ error: 'Not fully available for your requested dates.' });
      }

      const reservationIdentifier = await generateGlobalReservationIdentifier('shared_resource_reservation');
      const reservation = await createSharedResourceReservation({
        userId: Number(resource.user_id),
        sharedResourceId: Number(resource.id),
        reservationIdentifier,
        listingId: getSharedResourceReservationListingId(resource),
        reservationCheckinDate: checkinDate,
        reservationCheckoutDate: checkoutDate,
        requestedStartAt: requestedStartAt.toISOString(),
        requestedEndAt: requestedEndAt.toISOString(),
        spacesRequired: requestedSpaces,
        firstName,
        familyName,
        emailAddress,
        telephone,
        vehicleRegistration,
        reservationAmount,
        status: 'Awaiting Bank Transfer'
      });

      const bankResult = await pool.query(
        'SELECT bank_account_name, bank_sort_code, bank_account_number, bank_is_business, bank_iban, bank_bic FROM client_accounts WHERE id = $1 LIMIT 1',
        [Number(resource.client_account_id || 0)]
      );
      const bankRow = bankResult.rows[0] || {};
      const bankAccountName = String(bankRow.bank_account_name || '').trim();
      const bankSortCode = String(bankRow.bank_sort_code || '').trim();
      const bankAccountNumber = String(bankRow.bank_account_number || '').trim();
      const bankIban = String(bankRow.bank_iban || '').trim();
      const bankBic = String(bankRow.bank_bic || '').trim();
      const bankType = bankRow.bank_is_business === true ? 'Business' : 'Personal';

      if (!bankAccountName || !bankSortCode || !bankAccountNumber || !bankIban || !bankBic) {
        return res.status(400).json({ error: 'Host bank transfer details are incomplete. Please contact the host.' });
      }

      const lines = [
        htmlToPlainText(resource.full_description_html) || 'Facility reservation details',
        '',
        'Guest Name: ' + firstName + ' ' + familyName,
        'Arrival Date & Time: ' + formatDateTimeForMessage(requestedStartAt.toISOString()),
        'Departure Date & Time: ' + formatDateTimeForMessage(requestedEndAt.toISOString()),
        'Number of units: ' + String(requestedSpaces),
        'Cost: ' + String((reservationAmount === null ? 0 : reservationAmount).toFixed(2)),
        'Payment Method: Bank Transfer',
        '',
        'Bank Transfer Details:',
        'Account name: ' + bankAccountName,
        'Sort code: ' + bankSortCode,
        'Account number: ' + bankAccountNumber,
        'IBAN: ' + bankIban,
        'BIC: ' + bankBic,
        'Account type: ' + bankType
      ];

      const emailResult = await sendAppEmail({
        to: emailAddress,
        subject: String(resource.short_description || '').trim() || 'Facility Reservation',
        textBody: lines.join('\n')
      });

      return res.status(201).json({
        reservation,
        emailDeliveryWarning: emailResult.ok !== true,
        emailDeliveryReason: emailResult.ok ? '' : String(emailResult.error || '')
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to submit bank transfer facility enquiry.' });
    }
  });

  app.post('/api/public/facility-enquiry-landing-pages/:slug/online-payment/prepare', async (req, res) => {
    if (!stripeClient || !STRIPE_PUBLISHABLE_KEY) {
      return res.status(503).json({ error: 'Stripe is not configured on the server.' });
    }

    const requestedStartAtRaw = String(req.body.requestedStartAt || '').trim();
    const requestedEndAtRaw = String(req.body.requestedEndAt || '').trim();
    const requestedStartAt = new Date(requestedStartAtRaw);
    const requestedEndAt = new Date(requestedEndAtRaw);
    if (Number.isNaN(requestedStartAt.getTime()) || Number.isNaN(requestedEndAt.getTime()) || requestedEndAt.getTime() <= requestedStartAt.getTime()) {
      return res.status(400).json({ error: 'Requested end must be after requested start.' });
    }

    const checkinDate = normaliseDateKey(req.body.checkinDate) || getDateKeyFromEventDateTime(requestedStartAtRaw);
    const checkoutDate = normaliseDateKey(req.body.checkoutDate) || getDateKeyFromEventDateTime(requestedEndAtRaw);
    if (!checkinDate || !checkoutDate) {
      return res.status(400).json({ error: 'Checkin and checkout dates are required.' });
    }

    const firstName = normaliseSharedResourceReservationText(req.body.firstName, 100);
    const familyName = normaliseSharedResourceReservationText(req.body.familyName, 100);
    const emailAddress = normaliseSharedResourceReservationEmail(req.body.emailAddress);
    const telephone = normaliseSharedResourceReservationText(req.body.telephone, 60);
    const vehicleRegistration = normaliseSharedResourceReservationText(req.body.vehicleRegistration, 60) || '';
    const reservationAmount = normaliseSharedResourceReservationAmount(req.body.reservationAmount);

    if (!firstName || !familyName || !emailAddress || !telephone) {
      return res.status(400).json({ error: 'First name, family name, email address and telephone are required.' });
    }
    if (reservationAmount === null || reservationAmount <= 0) {
      return res.status(400).json({ error: 'A valid reservation amount is required for online payment.' });
    }

    try {
      const landingPage = await getActiveFacilityEnquiryLandingPageBySlug(req.params.slug);
      if (!landingPage) {
        return res.status(404).json({ error: 'Facility enquiry landing page not found.' });
      }
      if (String(landingPage.payment_method || '') !== 'online') {
        return res.status(400).json({ error: 'This landing page is not configured for online payment.' });
      }

      const resource = await getSharedResourceByIdPublic(Number(landingPage.shared_resource_id || 0));
      if (!resource) {
        return res.status(404).json({ error: 'Facility not found for this landing page.' });
      }
      if (resource.online_payment !== true) {
        return res.status(400).json({ error: 'Online payment is not enabled for this facility.' });
      }

      const hostUser = await getUserById(Number(resource.user_id));
      if (!hostUser || !hostUser.stripe_account_id) {
        return res.status(400).json({ error: 'Host Stripe account is not connected yet.' });
      }
      if (!isOnlinePaymentAvailableForHostUser(hostUser)) {
        return res.status(400).json({ error: 'Host online payment is currently unavailable.' });
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

      const existingReservations = await getSharedResourceReservationsByResourceId(Number(resource.id));
      const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
      const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
      const requestedSpaces = resource.resource_type === 'parking'
        ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
        : 1;

      const conflict = findCapacityConflictPeriod(
        existingReservations,
        requestedStartAt.toISOString(),
        requestedEndAt.toISOString(),
        requestedSpaces,
        maxUnits
      );
      if (conflict) {
        return res.status(409).json({ error: 'Not fully available for your requested dates.' });
      }

      const reservationIdentifier = await generateGlobalReservationIdentifier('shared_resource_reservation');
      const reservation = await createSharedResourceReservation({
        userId: resource.user_id,
        sharedResourceId: Number(resource.id),
        reservationIdentifier,
        listingId: getSharedResourceReservationListingId(resource),
        reservationCheckinDate: checkinDate,
        reservationCheckoutDate: checkoutDate,
        requestedStartAt: requestedStartAt.toISOString(),
        requestedEndAt: requestedEndAt.toISOString(),
        spacesRequired: requestedSpaces,
        firstName,
        familyName,
        emailAddress,
        telephone,
        vehicleRegistration,
        reservationAmount,
        status: 'Awaiting Online Confirmation',
        paymentProvider: 'stripe',
        paymentStatus: 'pending',
        paymentCurrency: 'gbp',
        paymentAmountMinor: toMinorUnits(reservationAmount)
      });

      const paymentIntent = await stripeClient.paymentIntents.create(
        {
          amount: toMinorUnits(reservationAmount),
          currency: 'gbp',
          automatic_payment_methods: { enabled: true },
          transfer_data: {
            destination: String(stripeAccount.id)
          },
          metadata: {
            reservation_type: 'facility_enquiry_landing_page',
            landing_page_slug: String(landingPage.public_slug || ''),
            reservation_id: String(reservation.id),
            reservation_identifier: String(reservation.reservation_identifier || reservationIdentifier),
            resource_id: String(resource.id),
            host_user_id: String(resource.user_id)
          },
          receipt_email: emailAddress
        },
        {
          idempotencyKey: 'facility-enquiry-' + String(reservation.reservation_identifier || reservationIdentifier)
        }
      );

      await updateSharedResourceReservationPaymentById(reservation.id, {
        paymentProvider: 'stripe',
        paymentIntentId: paymentIntent.id,
        paymentStatus: String(paymentIntent.status || '').toLowerCase(),
        paymentCurrency: String(paymentIntent.currency || 'gbp').toLowerCase(),
        paymentAmountMinor: Number.isInteger(paymentIntent.amount) ? paymentIntent.amount : toMinorUnits(reservationAmount),
        paymentLastError: ''
      });

      return res.status(201).json({
        reservationId: reservation.id,
        reservationIdentifier: reservation.reservation_identifier,
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to prepare online payment.' });
    }
  });
}

module.exports = {
  registerWorkflow5FacilityEnquiryRoutes
};
