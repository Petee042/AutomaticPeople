'use strict';

function registerWorkflow3FacilityBookingRoutes(app, deps) {
  const {
    requireScopedRole,
    getSharedResourcesForUser,
    hasManagerAssignmentScope,
    isSharedResourceAllowedByScope,
    getSharedResourceReservationsByResourceId,
    getListingByIdForUser,
    isListingAllowedByScope,
    isPropertyAllowedByScope,
    createSharedResourceForUser,
    getSharedResourceByIdForUser,
    updateSharedResourceForUser,
    updateSharedResourceReservationStatusForUser,
    getSharedResourceReservationByIdForUser,
    normaliseDateKey,
    getDateKeyFromEventDateTime,
    normaliseSharedResourceReservationText,
    normaliseSharedResourceReservationEmail,
    normaliseSharedResourceReservationAmount,
    normaliseSharedResourceReservationStatus,
    getSharedResourceReservationListingId,
    normaliseSharedResourceMaxUnits,
    findCapacityConflictPeriod,
    updateSharedResourceReservationForUser,
    deleteSharedResourceReservationForUser,
    deleteSharedResourceForUser,
    getReservationGuestOptionsForClientAccount,
    writeUserEventLog
  } = deps;

  app.get('/api/shared-resources/all-reservations', requireScopedRole('Staff'), async (req, res) => {
    try {
      let resources = await getSharedResourcesForUser(req.accessContext.effectiveOwnerUserId);
      if (hasManagerAssignmentScope(req)) {
        resources = resources.filter((resource) => isSharedResourceAllowedByScope(req, resource));
      }

      const reservationsArrays = await Promise.all(
        resources.map(async (resource) => {
          const rows = await getSharedResourceReservationsByResourceId(resource.id);
          return rows.map((row) => ({
            ...row,
            resource_short_description: resource.short_description || ''
          }));
        })
      );

      const reservations = reservationsArrays
        .flat()
        .sort((a, b) => new Date(a.requested_start_at).getTime() - new Date(b.requested_start_at).getTime());

      return res.json({ reservations });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load all reservations.' });
    }
  });

  app.post('/api/shared-resources', requireScopedRole('Manager'), async (req, res) => {
    try {
      if (hasManagerAssignmentScope(req)) {
        const scopedPropertyId = Number(req.body.propertyId);
        const scopedListingId = Number(req.body.listingId);

        if (Number.isInteger(scopedListingId) && scopedListingId > 0) {
          const listing = await getListingByIdForUser(scopedListingId, req.accessContext.effectiveOwnerUserId);
          if (!listing || !isListingAllowedByScope(req, listing)) {
            return res.status(403).json({ error: 'You are not allowed to create facilities for this listing.' });
          }
        }

        if (Number.isInteger(scopedPropertyId) && scopedPropertyId > 0) {
          if (!isPropertyAllowedByScope(req, scopedPropertyId)) {
            return res.status(403).json({ error: 'You are not allowed to create facilities for this property.' });
          }
        }

        if ((!Number.isInteger(scopedPropertyId) || scopedPropertyId <= 0)
          && (!Number.isInteger(scopedListingId) || scopedListingId <= 0)) {
          return res.status(403).json({ error: 'Please select an assigned property or listing when creating a facility.' });
        }
      }

      const { resource, error } = await createSharedResourceForUser(
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId,
        {
          shortDescription: req.body.shortDescription,
          fullDescriptionHtml: req.body.fullDescriptionHtml,
          maxUnits: req.body.maxUnits,
          maxDaysAdvanceBooking: req.body.maxDaysAdvanceBooking,
          propertyId: req.body.propertyId,
          listingId: req.body.listingId,
          resourceType: req.body.resourceType,
          freeOfCharge: req.body.freeOfCharge,
          cashOnSite: req.body.cashOnSite,
          bankTransfer: req.body.bankTransfer,
          onlinePayment: req.body.onlinePayment,
          freeOfChargeMessageHtml: req.body.freeOfChargeMessageHtml,
          cashOnSiteMessageHtml: req.body.cashOnSiteMessageHtml,
          bankTransferMessageHtml: req.body.bankTransferMessageHtml,
          onlinePaymentMessageHtml: req.body.onlinePaymentMessageHtml,
          chargeBasis: req.body.chargeBasis,
          dailyChargeMode: req.body.dailyChargeMode,
          dailyRate: req.body.dailyRate,
          hourlyChargeMode: req.body.hourlyChargeMode,
          hourlyRate: req.body.hourlyRate,
          hourlyRates: req.body.hourlyRates
        }
      );
      if (error) {
        const status = error === 'Client account context is required.' ? 400 : 400;
        return res.status(status).json({ error });
      }
      return res.status(201).json({ resource });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create shared resource.' });
    }
  });

  app.get('/api/shared-resources/:resourceId', requireScopedRole('Staff'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      return res.status(400).json({ error: 'Invalid shared resource id.' });
    }

    try {
      const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!resource) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, resource)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      return res.json({ resource });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load shared resource.' });
    }
  });

  app.get('/api/shared-resources/:resourceId/reservations', requireScopedRole('Staff'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      return res.status(400).json({ error: 'Invalid shared resource id.' });
    }

    try {
      const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!resource) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, resource)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      const reservations = await getSharedResourceReservationsByResourceId(resourceId);
      return res.json({ reservations });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load shared resource reservations.' });
    }
  });

  app.put('/api/shared-resources/:resourceId', requireScopedRole('Manager'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      return res.status(400).json({ error: 'Invalid shared resource id.' });
    }

    try {
      const existing = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!existing) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, existing)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }

      const { resource, error } = await updateSharedResourceForUser(
        resourceId,
        req.accessContext.effectiveOwnerUserId,
        req.accessContext.activeClientAccountId,
        {
          shortDescription: req.body.shortDescription,
          fullDescriptionHtml: req.body.fullDescriptionHtml,
          maxUnits: req.body.maxUnits,
          maxDaysAdvanceBooking: req.body.maxDaysAdvanceBooking,
          propertyId: req.body.propertyId,
          listingId: req.body.listingId,
          resourceType: req.body.resourceType,
          freeOfCharge: req.body.freeOfCharge,
          cashOnSite: req.body.cashOnSite,
          bankTransfer: req.body.bankTransfer,
          onlinePayment: req.body.onlinePayment,
          freeOfChargeMessageHtml: req.body.freeOfChargeMessageHtml,
          cashOnSiteMessageHtml: req.body.cashOnSiteMessageHtml,
          bankTransferMessageHtml: req.body.bankTransferMessageHtml,
          onlinePaymentMessageHtml: req.body.onlinePaymentMessageHtml,
          chargeBasis: req.body.chargeBasis,
          dailyChargeMode: req.body.dailyChargeMode,
          dailyRate: req.body.dailyRate,
          hourlyChargeMode: req.body.hourlyChargeMode,
          hourlyRate: req.body.hourlyRate,
          hourlyRates: req.body.hourlyRates
        }
      );
      if (error === 'Shared resource not found.') {
        return res.status(404).json({ error });
      }
      if (error) {
        return res.status(400).json({ error });
      }
      return res.json({ resource });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update shared resource.' });
    }
  });

  app.put('/api/shared-resources/:resourceId/reservations/:reservationId/status', requireScopedRole('Manager'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Invalid resource or reservation id.' });
    }

    try {
      const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!resource) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, resource)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }

      const result = await updateSharedResourceReservationStatusForUser(
        reservationId,
        resourceId,
        req.accessContext.effectiveOwnerUserId,
        req.body.status
      );

      if (result.error === 'Reservation not found.') {
        return res.status(404).json({ error: result.error });
      }
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      const nextStatus = String(result && result.reservation && result.reservation.status || '').trim().toLowerCase();
      const nextStatusIsPaid = nextStatus === 'confirmed' || nextStatus === 'paid';
      if (nextStatusIsPaid) {
        await writeUserEventLog({
          actorUserId: Number(req.session && req.session.userId || 0),
          clientAccountId: Number(req.accessContext && req.accessContext.activeClientAccountId || 0),
          eventType: 'facility_payment_received',
          description: 'Facility Payment Received - ' + String(result && result.reservation && result.reservation.reservation_identifier || ''),
          detail: {
            dtg: new Date().toISOString(),
            reservationId: Number(result && result.reservation && result.reservation.id || 0),
            reservationIdentifier: String(result && result.reservation && result.reservation.reservation_identifier || ''),
            resourceId,
            resourceName: String(resource && resource.short_description || ''),
            nextStatus: String(result && result.reservation && result.reservation.status || '')
          }
        });

        await writeUserEventLog({
          actorUserId: Number(req.session && req.session.userId || 0),
          clientAccountId: Number(req.accessContext && req.accessContext.activeClientAccountId || 0),
          eventType: 'provisional_reservation_paid',
          description: 'Provisional Reservation Confirmed Paid - ' + String(result && result.reservation && result.reservation.reservation_identifier || ''),
          detail: {
            dtg: new Date().toISOString(),
            reservationId: Number(result && result.reservation && result.reservation.id || 0),
            reservationIdentifier: String(result && result.reservation && result.reservation.reservation_identifier || ''),
            resourceId,
            resourceName: String(resource && resource.short_description || ''),
            nextStatus: String(result && result.reservation && result.reservation.status || '')
          }
        });
      }

      return res.json({ reservation: result.reservation });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update reservation status.' });
    }
  });

  app.get('/api/shared-resources/:resourceId/reservations/:reservationId', requireScopedRole('Staff'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Invalid resource or reservation id.' });
    }

    try {
      const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!resource) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, resource)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }

      const existingReservation = await getSharedResourceReservationByIdForUser(
        reservationId,
        resourceId,
        req.accessContext.effectiveOwnerUserId
      );
      if (!existingReservation) {
        return res.status(404).json({ error: 'Reservation not found.' });
      }

      const reservation = await getSharedResourceReservationByIdForUser(reservationId, resourceId, req.accessContext.effectiveOwnerUserId);
      if (!reservation) {
        return res.status(404).json({ error: 'Reservation not found.' });
      }

      return res.json({ reservation });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load reservation.' });
    }
  });

  app.put('/api/shared-resources/:resourceId/reservations/:reservationId', requireScopedRole('Manager'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Invalid resource or reservation id.' });
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
    const reservationAmount = normaliseSharedResourceReservationAmount(req.body.reservationAmount);
    const status = normaliseSharedResourceReservationStatus(req.body.status);
    if (!firstName || !familyName || !emailAddress || !telephone || !status) {
      return res.status(400).json({ error: 'First name, family name, email address, telephone and status are required.' });
    }

    try {
      const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!resource) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, resource)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }

      const reservationListingId = getSharedResourceReservationListingId(resource);

      const existingReservations = await getSharedResourceReservationsByResourceId(resourceId);
      const maxUnits = normaliseSharedResourceMaxUnits(resource.max_units) || 1;
      const requestedSpacesRaw = normaliseSharedResourceMaxUnits(req.body.spacesRequired) || 1;
      const requestedSpaces = resource.resource_type === 'parking'
        ? Math.min(maxUnits, Math.max(1, requestedSpacesRaw))
        : 1;

      const conflict = findCapacityConflictPeriod(
        existingReservations.filter((row) => Number(row.id) !== reservationId),
        requestedStartAt.toISOString(),
        requestedEndAt.toISOString(),
        requestedSpaces,
        maxUnits
      );
      if (conflict) {
        return res.status(409).json({ error: 'Not fully available for the updated requested dates.' });
      }

      const result = await updateSharedResourceReservationForUser(
        reservationId,
        resourceId,
        req.accessContext.effectiveOwnerUserId,
        {
          reservationCheckinDate: checkinDate,
          reservationCheckoutDate: checkoutDate,
          requestedStartAt: requestedStartAt.toISOString(),
          requestedEndAt: requestedEndAt.toISOString(),
          listingId: reservationListingId,
          spacesRequired: requestedSpaces,
          firstName,
          familyName,
          emailAddress,
          telephone,
          reservationAmount,
          status
        }
      );

      if (result.error === 'Reservation not found.') {
        return res.status(404).json({ error: result.error });
      }
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      return res.json({ reservation: result.reservation });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update reservation.' });
    }
  });

  app.delete('/api/shared-resources/:resourceId/reservations/:reservationId', requireScopedRole('Manager'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(resourceId) || resourceId <= 0 || !Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Invalid resource or reservation id.' });
    }

    try {
      const resource = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!resource) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, resource)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }

      const existingReservation = await getSharedResourceReservationByIdForUser(
        reservationId,
        resourceId,
        req.accessContext.effectiveOwnerUserId
      );
      if (!existingReservation) {
        return res.status(404).json({ error: 'Reservation not found.' });
      }

      const result = await deleteSharedResourceReservationForUser(
        reservationId,
        resourceId,
        req.accessContext.effectiveOwnerUserId
      );

      if (result.error === 'Reservation not found.') {
        return res.status(404).json({ error: result.error });
      }
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      const statusBeforeDelete = String(existingReservation.status || '').trim();
      const isProvisional = statusBeforeDelete.toLowerCase().startsWith('awaiting_');
      if (isProvisional) {
        await writeUserEventLog({
          actorUserId: Number(req.session && req.session.userId || 0),
          clientAccountId: Number(req.accessContext && req.accessContext.activeClientAccountId || 0),
          eventType: 'provisional_reservation_deleted',
          description: 'Provisional Reservation Deleted - ' + String(existingReservation.reservation_identifier || ''),
          detail: {
            dtg: new Date().toISOString(),
            reservationId: Number(existingReservation.id || 0),
            reservationIdentifier: String(existingReservation.reservation_identifier || ''),
            resourceId,
            resourceName: String(resource && resource.short_description || ''),
            statusBeforeDelete,
            requestedStartAt: String(existingReservation.requested_start_at || ''),
            requestedEndAt: String(existingReservation.requested_end_at || '')
          }
        });
      }

      return res.json({ deleted: true, id: reservationId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete reservation.' });
    }
  });

  app.delete('/api/shared-resources/:resourceId', requireScopedRole('Manager'), async (req, res) => {
    const resourceId = Number(req.params.resourceId);
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      return res.status(400).json({ error: 'Invalid shared resource id.' });
    }

    try {
      const existing = await getSharedResourceByIdForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (!existing) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }
      if (!isSharedResourceAllowedByScope(req, existing)) {
        return res.status(404).json({ error: 'Shared resource not found.' });
      }

      const result = await deleteSharedResourceForUser(resourceId, req.accessContext.effectiveOwnerUserId);
      if (result.error === 'Shared resource not found.') {
        return res.status(404).json({ error: result.error });
      }
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ deletedResourceId: result.deletedResourceId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete shared resource.' });
    }
  });

  app.get('/api/shared-reservations/guest-users', requireScopedRole('Staff'), async (req, res) => {
    try {
      const guestUsers = await getReservationGuestOptionsForClientAccount(req.accessContext.activeClientAccountId);
      return res.json({
        guestUsers: guestUsers.map((row) => {
          const firstName = String(row && row.first_name || '').trim();
          const familyName = String(row && row.family_name || '').trim();
          const email = String(row && row.email || '').trim();
          const telephone = String(row && row.telephone || '').trim();
          const fullName = [firstName, familyName].filter(Boolean).join(' ').trim();
          return {
            id: Number(row && row.id || 0) || null,
            email,
            firstName,
            familyName,
            telephone,
            displayName: fullName || email || 'Guest'
          };
        })
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to load reservation guest users.' });
    }
  });
}

module.exports = {
  registerWorkflow3FacilityBookingRoutes
};
