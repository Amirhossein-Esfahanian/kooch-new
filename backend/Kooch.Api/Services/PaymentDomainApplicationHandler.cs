using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PaymentDomainApplicationHandler(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService) : IPaymentDomainApplicationHandler
{
    private static readonly ReservationStatus[] CapacityConsumingStatuses =
    [
        ReservationStatus.ApprovedAwaitingPayment,
        ReservationStatus.Confirmed,
        ReservationStatus.Paid
    ];

    public async Task<PaymentDomainApplicationOutcome> ApplyAsync(
        Payment payment,
        CancellationToken cancellationToken = default)
    {
        if (payment.BookingSessionId.HasValue)
        {
            await ApplySessionPaymentAsync(payment, cancellationToken);
        }
        else if (payment.ReservationId.HasValue)
        {
            await ApplyLegacyPaymentAsync(payment, cancellationToken);
        }
        else
        {
            throw new InvalidOperationException("Payment has no supported parent.");
        }

        return PaymentDomainApplicationOutcome.Applied;
    }

    private async Task ApplySessionPaymentAsync(
        Payment payment,
        CancellationToken cancellationToken)
    {
        if (payment.ReservationId.HasValue)
        {
            throw new InvalidOperationException("A session payment cannot target a legacy reservation.");
        }

        var session = await LockBookingSessionAsync(payment.BookingSessionId!.Value, cancellationToken);
        var items = await LockPaymentItemsAsync(payment.Id, cancellationToken);
        ValidatePaymentItems(payment, items);

        var sessionReservationIds = await dbContext.Reservations.AsNoTracking()
            .Where(reservation => reservation.BookingSessionId == session.Id)
            .OrderBy(reservation => reservation.Id)
            .Select(reservation => reservation.Id)
            .ToListAsync(cancellationToken);
        var itemReservationIds = items.Select(item => item.ReservationId).Order().ToArray();
        if (sessionReservationIds.Count == 0 ||
            itemReservationIds.Except(sessionReservationIds).Any())
        {
            throw new InvalidOperationException(
                "A payment item targets a reservation outside the booking session.");
        }

        var lockTargets = await GetReservationLockTargetsAsync(sessionReservationIds, cancellationToken);
        await LockCapacityResourcesAsync(lockTargets, cancellationToken);
        var allReservations = await LockReservationsAsync(sessionReservationIds, cancellationToken);
        var now = DateTime.UtcNow;
        var includedReservations = ValidateAndResolveSessionApplicationScope(
            session,
            payment,
            items,
            allReservations,
            now);
        var includedReservationIds = includedReservations
            .Select(reservation => reservation.Id)
            .ToArray();
        await EnsureNoPreviousSuccessfulPaymentAsync(
            payment.Id,
            includedReservationIds,
            cancellationToken);
        await EnsureSessionCapacityIsStillHeldAsync(includedReservations, cancellationToken);

        ApplySuccessfulPayment(payment, includedReservations, now);
    }

    private async Task ApplyLegacyPaymentAsync(
        Payment payment,
        CancellationToken cancellationToken)
    {
        if (payment.BookingSessionId.HasValue)
        {
            throw new InvalidOperationException("A legacy payment cannot target a booking session.");
        }

        var reservationId = payment.ReservationId!.Value;
        var targets = await GetReservationLockTargetsAsync([reservationId], cancellationToken);
        await LockCapacityResourcesAsync(targets, cancellationToken);
        var reservation = (await LockReservationsAsync([reservationId], cancellationToken)).Single();
        var now = DateTime.UtcNow;
        ValidatePayableReservation(reservation, payment.Currency, now);

        var previouslyPaidAmount = await dbContext.Payments.AsNoTracking()
            .Where(candidate =>
                candidate.Id != payment.Id &&
                candidate.ReservationId == reservation.Id &&
                candidate.Status == PaymentStatus.Successful)
            .SumAsync(candidate => (decimal?)candidate.Amount, cancellationToken) ?? 0;
        if (previouslyPaidAmount + payment.Amount < reservation.FinalAmount)
        {
            throw new InvalidOperationException(
                "Successful payment does not cover the reservation balance.");
        }

        var capacityExists = await HasLegacyCapacityAsync(reservation, cancellationToken);
        ApplySuccessfulPayment(payment, [reservation], now, capacityExists);
    }

    private static void ValidatePaymentItems(Payment payment, IReadOnlyList<PaymentItem> items)
    {
        if (items.Count == 0)
        {
            throw new InvalidOperationException("A session payment must contain payment items.");
        }

        if (items.Select(item => item.ReservationId).Distinct().Count() != items.Count)
        {
            throw new InvalidOperationException("Payment allocations contain duplicate reservations.");
        }

        if (items.Sum(item => item.AllocatedAmount) != payment.Amount)
        {
            throw new InvalidOperationException("Payment allocations do not match the payment amount.");
        }

        if (items.Any(item =>
                item.AllocatedAmount <= 0 ||
                !CurrencyEquals(item.Currency, payment.Currency)))
        {
            throw new InvalidOperationException("Payment allocation currency or amount is invalid.");
        }
    }

    private static IReadOnlyList<Reservation> ValidateAndResolveSessionApplicationScope(
        BookingSession session,
        Payment payment,
        IReadOnlyList<PaymentItem> items,
        IReadOnlyList<Reservation> allReservations,
        DateTime now)
    {
        if (!CurrencyEquals(session.Currency, payment.Currency))
        {
            throw new InvalidOperationException("Payment currency does not match the booking session.");
        }

        var itemsByReservationId = items.ToDictionary(item => item.ReservationId);
        var includedReservations = new List<Reservation>(items.Count);
        foreach (var reservation in allReservations)
        {
            if (reservation.BookingSessionId != session.Id)
            {
                throw new InvalidOperationException("A payment item targets a reservation outside the booking session.");
            }

            if (itemsByReservationId.TryGetValue(reservation.Id, out var item))
            {
                ValidatePayableReservation(reservation, payment.Currency, now);
                if (item.AllocatedAmount != reservation.FinalAmount)
                {
                    throw new InvalidOperationException(
                        "Payment allocation does not match the reservation payable amount.");
                }

                includedReservations.Add(reservation);
                continue;
            }

            if (reservation.Status != ReservationStatus.Rejected)
            {
                throw new InvalidOperationException(
                    "Only rejected reservations may be excluded from a session payment.");
            }
        }

        if (includedReservations.Count != items.Count)
        {
            throw new InvalidOperationException(
                "A payment item targets a reservation outside the booking session.");
        }

        return includedReservations;
    }

    private static void ValidatePayableReservation(
        Reservation reservation,
        string paymentCurrency,
        DateTime now)
    {
        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment)
        {
            throw new InvalidOperationException("Every reservation must be awaiting payment.");
        }

        if (!reservation.PaymentExpiresAtUtc.HasValue || reservation.PaymentExpiresAtUtc.Value <= now)
        {
            throw new InvalidOperationException("A reservation payment deadline has expired.");
        }

        if (!CurrencyEquals(reservation.Currency, paymentCurrency))
        {
            throw new InvalidOperationException("Reservation currency does not match the payment.");
        }

        if (reservation.PaidAtUtc.HasValue)
        {
            throw new InvalidOperationException("A reservation has already been paid.");
        }
    }

    private async Task EnsureNoPreviousSuccessfulPaymentAsync(
        int paymentId,
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken)
    {
        var alreadyPaid = await dbContext.Payments.AsNoTracking()
            .AnyAsync(candidate =>
                candidate.Id != paymentId &&
                candidate.Status == PaymentStatus.Successful &&
                (candidate.ReservationId.HasValue && reservationIds.Contains(candidate.ReservationId.Value) ||
                 candidate.Items.Any(item => reservationIds.Contains(item.ReservationId))),
                cancellationToken);
        if (alreadyPaid)
        {
            throw new InvalidOperationException("A reservation already has a successful payment.");
        }
    }

    private async Task EnsureSessionCapacityIsStillHeldAsync(
        IReadOnlyList<Reservation> reservations,
        CancellationToken cancellationToken)
    {
        foreach (var group in reservations.GroupBy(reservation => reservation.RoomTypeId))
        {
            var checkIn = group.Min(reservation => reservation.CheckInDate);
            var checkOut = group.Max(reservation => reservation.CheckOutDate);
            var availability = await effectiveAvailabilityService.GetRangeAsync(
                [group.Key],
                checkIn,
                checkOut,
                cancellationToken: cancellationToken);
            if (!availability.TryGetValue(group.Key, out var roomTypeAvailability))
            {
                throw new InvalidOperationException("Reservation room type is unavailable.");
            }

            foreach (var reservation in group)
            {
                for (var date = reservation.CheckInDate; date < reservation.CheckOutDate; date = date.AddDays(1))
                {
                    if (!roomTypeAvailability.Nights.TryGetValue(date, out var night) ||
                        night.IsClosed ||
                        night.ConfiguredStatus is not (AvailabilityStatus.Available or AvailabilityStatus.OnRequest) ||
                        night.ClaimedCapacity > night.ConfiguredCapacity)
                    {
                        throw new InvalidOperationException("Held reservation capacity is no longer valid.");
                    }
                }
            }
        }

        await EnsureNamedRoomsRemainHeldAsync(reservations, cancellationToken);
    }

    private async Task EnsureNamedRoomsRemainHeldAsync(
        IReadOnlyList<Reservation> reservations,
        CancellationToken cancellationToken)
    {
        var namedReservations = reservations.Where(reservation => reservation.RoomId.HasValue).ToArray();
        if (namedReservations.Length == 0)
        {
            return;
        }

        var roomIds = namedReservations.Select(reservation => reservation.RoomId!.Value).Distinct().ToArray();
        var minCheckIn = namedReservations.Min(reservation => reservation.CheckInDate);
        var maxCheckOut = namedReservations.Max(reservation => reservation.CheckOutDate);
        var claims = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                reservation.RoomId.HasValue &&
                roomIds.Contains(reservation.RoomId.Value) &&
                reservation.CheckInDate < maxCheckOut &&
                reservation.CheckOutDate > minCheckIn &&
                CapacityConsumingStatuses.Contains(reservation.Status))
            .Select(reservation => new
            {
                reservation.Id,
                reservation.RoomId,
                reservation.CheckInDate,
                reservation.CheckOutDate
            })
            .ToListAsync(cancellationToken);
        if (namedReservations.Any(reservation => claims.Any(claim =>
                claim.Id != reservation.Id &&
                claim.RoomId == reservation.RoomId &&
                claim.CheckInDate < reservation.CheckOutDate &&
                claim.CheckOutDate > reservation.CheckInDate)))
        {
            throw new InvalidOperationException("A named room capacity hold is no longer valid.");
        }
    }

    private async Task<bool> HasLegacyCapacityAsync(
        Reservation reservation,
        CancellationToken cancellationToken)
    {
        var availability = await effectiveAvailabilityService.GetRangeAsync(
            [reservation.RoomTypeId],
            reservation.CheckInDate,
            reservation.CheckOutDate,
            reservation.Id,
            cancellationToken);
        var roomTypeAvailability = availability[reservation.RoomTypeId];
        return roomTypeAvailability.HasCapacityForFullRange(1) &&
               (!reservation.RoomId.HasValue ||
                !roomTypeAvailability.ClaimedRoomIds.Contains(reservation.RoomId.Value));
    }

    private void ApplySuccessfulPayment(
        Payment payment,
        IReadOnlyList<Reservation> reservations,
        DateTime now,
        bool capacityExists = true)
    {
        foreach (var reservation in reservations)
        {
            reservation.PaidAtUtc = now;
            reservation.ChangedAtUtc = now;
            reservation.ChangedByUserId = null;
            if (capacityExists)
            {
                reservation.Status = ReservationStatus.Confirmed;
                reservation.ConfirmedAtUtc ??= now;
            }
            else
            {
                reservation.Status = ReservationStatus.CapacityLost;
            }

            AddAuditAndNotification(payment, reservation, now, capacityExists);
        }

        ConsumePaymentTokens(reservations.Select(reservation => reservation.Id).ToHashSet(), now);
    }

    private void AddAuditAndNotification(
        Payment payment,
        Reservation reservation,
        DateTime now,
        bool capacityExists)
    {
        dbContext.AuditLogs.Add(new AuditLog
        {
            UserId = reservation.ClientId,
            PropertyId = reservation.PropertyId,
            Action = AuditAction.BookingConfirmed,
            EntityType = nameof(Reservation),
            EntityId = reservation.Id,
            EntityName = reservation.ReservationNumber,
            Description = capacityExists
                ? $"Payment {payment.Id} confirmed reservation {reservation.ReservationNumber}."
                : $"Payment {payment.Id} was received after reservation capacity was lost.",
            OccurredAtUtc = now
        });
        dbContext.NotificationLogs.Add(new NotificationLog
        {
            RecipientUserId = reservation.ClientId,
            RecipientGuestId = reservation.GuestId,
            PropertyId = reservation.PropertyId,
            ReservationId = reservation.Id,
            EventType = NotificationEventType.PaymentSuccessful,
            Channels = NotificationChannel.InApp,
            Recipient = $"user:{reservation.ClientId}",
            Subject = reservation.ReservationNumber,
            Message = capacityExists
                ? $"Payment succeeded and reservation {reservation.ReservationNumber} was confirmed."
                : $"Payment succeeded but reservation {reservation.ReservationNumber} lost capacity.",
            DataJson = JsonSerializer.Serialize(new
            {
                paymentId = payment.Id,
                reservationId = reservation.Id,
                reservationNumber = reservation.ReservationNumber,
                reservation.PropertyId
            }),
            Status = NotificationStatus.Logged
        });
    }

    private void ConsumePaymentTokens(IReadOnlySet<int> reservationIds, DateTime now)
    {
        foreach (var token in dbContext.ReservationPaymentLinkTokens.Local
                     .Where(token => reservationIds.Contains(token.ReservationId) && !token.UsedAtUtc.HasValue))
        {
            token.UsedAtUtc = now;
            token.UpdatedAtUtc = now;
        }
    }

    private async Task<BookingSession> LockBookingSessionAsync(int id, CancellationToken token) =>
        await GetBookingSessionLockQuery(id).SingleOrDefaultAsync(token)
        ?? throw new KeyNotFoundException("Booking session not found.");

    private IQueryable<BookingSession> GetBookingSessionLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.BookingSessions.FromSqlInterpolated(
                $"SELECT * FROM BookingSessions WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.BookingSessions.Where(session => session.Id == id);

    private async Task<IReadOnlyList<PaymentItem>> LockPaymentItemsAsync(
        int paymentId,
        CancellationToken cancellationToken)
    {
        var ids = await dbContext.PaymentItems.AsNoTracking()
            .Where(item => item.PaymentId == paymentId)
            .OrderBy(item => item.Id)
            .Select(item => item.Id)
            .ToListAsync(cancellationToken);
        var items = new List<PaymentItem>(ids.Count);
        foreach (var id in ids)
        {
            items.Add(await GetPaymentItemLockQuery(id).SingleAsync(cancellationToken));
        }

        return items;
    }

    private IQueryable<PaymentItem> GetPaymentItemLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.PaymentItems.FromSqlInterpolated(
                $"SELECT * FROM PaymentItems WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.PaymentItems.Where(item => item.Id == id);

    private async Task<IReadOnlyList<ReservationLockTarget>> GetReservationLockTargetsAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken) =>
        await dbContext.Reservations.AsNoTracking()
            .Where(reservation => reservationIds.Contains(reservation.Id))
            .OrderBy(reservation => reservation.Id)
            .Select(reservation => new ReservationLockTarget(
                reservation.Id,
                reservation.RoomTypeId,
                reservation.RoomId))
            .ToListAsync(cancellationToken);

    private async Task LockCapacityResourcesAsync(
        IReadOnlyList<ReservationLockTarget> targets,
        CancellationToken cancellationToken)
    {
        foreach (var roomTypeId in targets.Select(target => target.RoomTypeId).Distinct().Order())
        {
            _ = await GetRoomTypeLockQuery(roomTypeId).SingleAsync(cancellationToken);
        }

        foreach (var roomId in targets.Where(target => target.RoomId.HasValue)
                     .Select(target => target.RoomId!.Value).Distinct().Order())
        {
            _ = await GetRoomLockQuery(roomId).SingleAsync(cancellationToken);
        }
    }

    private IQueryable<RoomType> GetRoomTypeLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.RoomTypes.FromSqlInterpolated(
                $"SELECT * FROM RoomTypes WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.RoomTypes.Where(roomType => roomType.Id == id);

    private IQueryable<Room> GetRoomLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.Rooms.FromSqlInterpolated(
                $"SELECT * FROM Rooms WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.Rooms.Where(room => room.Id == id);

    private async Task<IReadOnlyList<Reservation>> LockReservationsAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken)
    {
        var reservations = new List<Reservation>(reservationIds.Count);
        foreach (var id in reservationIds.Order())
        {
            reservations.Add(await GetReservationLockQuery(id).SingleAsync(cancellationToken));
        }

        var ids = reservations.Select(reservation => reservation.Id).ToArray();
        await dbContext.ReservationPaymentLinkTokens
            .Where(token => ids.Contains(token.ReservationId) && token.UsedAtUtc == null)
            .LoadAsync(cancellationToken);
        return reservations;
    }

    private IQueryable<Reservation> GetReservationLockQuery(int id) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.Reservations.FromSqlInterpolated(
                $"SELECT * FROM Reservations WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            : dbContext.Reservations.Where(reservation => reservation.Id == id);

    private static bool CurrencyEquals(string left, string right) =>
        string.Equals(left?.Trim(), right?.Trim(), StringComparison.OrdinalIgnoreCase);

    private sealed record ReservationLockTarget(int ReservationId, int RoomTypeId, int? RoomId);
}
