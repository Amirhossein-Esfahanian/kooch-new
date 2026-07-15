using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class ReservationService(
    KoochDbContext dbContext,
    IReservationAvailabilityService availabilityService,
    IReservationPricingService pricingService,
    IReservationNumberGenerator reservationNumberGenerator,
    INotificationService notificationService,
    IAuditLogService auditLogService,
    IPermissionService permissionService,
    IReservationStatusWorkflow statusWorkflow,
    IEffectiveAvailabilityService effectiveAvailabilityService,
    IHostEnvironment hostEnvironment) : IReservationService
{
    private const string PaymentWindowMinutesSettingKey = "reservation.paymentWindowMinutes";
    private const int DefaultPaymentWindowMinutes = 10;
    private const decimal MaximumStoredAmount = 9999999999999999.99m;

    public async Task<PagedResult<ReservationListItemResponse>> SearchAsync(
        ReservationListQuery query,
        CancellationToken cancellationToken = default)
    {
        return await SearchInternalAsync(query, null, null, cancellationToken);
    }

    public async Task<PagedResult<ReservationListItemResponse>> SearchByPropertyAsync(
        int propertyId,
        ReservationListQuery query,
        CancellationToken cancellationToken = default)
    {
        return await SearchInternalAsync(query, propertyId, null, cancellationToken);
    }

    public async Task<ReservationResponse> GetByIdAsync(
        int reservationId,
        int? propertyId = null,
        CancellationToken cancellationToken = default)
    {
        var reservation = await ReservationQuery()
            .SingleOrDefaultAsync(item =>
                    item.Id == reservationId &&
                    (!propertyId.HasValue || item.PropertyId == propertyId.Value),
                cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        reservation = await ExpireAndReloadIfNeededAsync(reservation, cancellationToken);
        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
        response.Timeline = await BuildTimelineAsync(reservation, cancellationToken);
        response.CouponDiscountAmount = await dbContext.CouponUsages.AsNoTracking()
            .Where(usage => usage.ReservationId == reservationId)
            .SumAsync(usage => (decimal?)usage.DiscountAmount, cancellationToken) ?? 0;

        return response;
    }

    public async Task<PagedResult<ReservationListItemResponse>> SearchByGuestUserAsync(
        int userId,
        ReservationListQuery query,
        CancellationToken cancellationToken = default)
    {
        var guestId = await dbContext.Guests.AsNoTracking()
            .Where(guest => guest.UserId == userId)
            .Select(guest => (int?)guest.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (!guestId.HasValue)
        {
            return new PagedResult<ReservationListItemResponse>
            {
                Items = [],
                TotalCount = 0,
                Page = Math.Max(1, query.Page),
                PageSize = Math.Clamp(query.PageSize, 1, 100),
                TotalPages = 0
            };
        }

        return await SearchInternalAsync(query, null, guestId.Value, cancellationToken);
    }

    public async Task<ReservationResponse> GetByIdForGuestUserAsync(
        int userId,
        int reservationId,
        CancellationToken cancellationToken = default)
    {
        var reservation = await ReservationQuery()
            .SingleOrDefaultAsync(item =>
                    item.Id == reservationId &&
                    item.Guest != null &&
                    item.Guest.UserId == userId,
                cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        reservation = await ExpireAndReloadIfNeededAsync(reservation, cancellationToken);
        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
        await ApplyGuestPaymentSummaryAsync(response, reservation, DateTime.UtcNow, cancellationToken);
        response.Timeline = await BuildTimelineAsync(reservation, cancellationToken);
        response.CouponDiscountAmount = await dbContext.CouponUsages.AsNoTracking()
            .Where(usage => usage.ReservationId == reservationId)
            .SumAsync(usage => (decimal?)usage.DiscountAmount, cancellationToken) ?? 0;

        return response;
    }

    public async Task<ReservationResponse> GetByNumberForGuestUserAsync(
        int userId,
        string reservationNumber,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(reservationNumber))
        {
            throw new KeyNotFoundException("Reservation not found.");
        }

        var normalizedReservationNumber = reservationNumber.Trim();
        var reservation = await ReservationQuery()
            .SingleOrDefaultAsync(item =>
                    item.ReservationNumber == normalizedReservationNumber &&
                    item.Guest != null &&
                    item.Guest.UserId == userId,
                cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        reservation = await ExpireAndReloadIfNeededAsync(reservation, cancellationToken);
        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
        await ApplyGuestPaymentSummaryAsync(response, reservation, DateTime.UtcNow, cancellationToken);
        response.Timeline = await BuildTimelineAsync(reservation, cancellationToken);
        response.CouponDiscountAmount = await dbContext.CouponUsages.AsNoTracking()
            .Where(usage => usage.ReservationId == reservation.Id)
            .SumAsync(usage => (decimal?)usage.DiscountAmount, cancellationToken) ?? 0;

        return response;
    }

    public async Task<ReservationResponse> CreateAsync(
        ReservationCreateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        EnsureAdminUser(currentUser.Role);
        ValidateDateRange(request.CheckInDate, request.CheckOutDate);

        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == request.PropertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var room = await dbContext.Rooms.AsNoTracking()
            .Include(item => item.RoomType)
            .SingleOrDefaultAsync(item => item.Id == request.RoomId && item.IsActive, cancellationToken)
            ?? throw new KeyNotFoundException("Room not found.");
        if (room.RoomType.PropertyId != request.PropertyId)
        {
            throw new ArgumentException("Selected room does not belong to the selected property.");
        }
        if (!room.RoomType.IsActive)
        {
            throw new KeyNotFoundException("Room type not found.");
        }

        var roomType = room.RoomType;
        request.RoomTypeId = roomType.Id;

        var guest = await dbContext.Guests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == request.GuestId, cancellationToken)
            ?? throw new KeyNotFoundException("Guest not found.");
        var selectedRoomIds = new List<int> { room.Id };
        const int roomCount = 1;

        var availability = await availabilityService.GetAvailabilityAsync(
            request.PropertyId,
            request.RoomTypeId,
            request.CheckInDate,
            request.CheckOutDate,
            roomCount,
            excludedReservationId: null,
            cancellationToken: cancellationToken);
        ValidateAvailabilityForCreate(availability, roomCount);

        var pricePreview = await pricingService.PreviewReservationPriceAsync(
            new ReservationPricePreviewRequest
            {
                PropertyId = request.PropertyId,
                RoomTypeId = request.RoomTypeId,
                CheckInDate = request.CheckInDate,
                CheckOutDate = request.CheckOutDate,
                Adults = request.Adults,
                Children = request.Children,
                ChildAges = request.ChildAges,
                RoomCount = roomCount,
                GuestType = request.GuestType
            },
            cancellationToken);

        var reservationNumber = await reservationNumberGenerator.GenerateAsync(DateTime.UtcNow, cancellationToken);
        var isOnRequest = availability.HasOnRequestNight;
        var requestedStatus = request.Status ?? (isOnRequest
            ? ReservationStatus.PendingApproval
            : ReservationStatus.Pending);
        statusWorkflow.ValidateManualCreationStatus(isOnRequest, requestedStatus);
        requestedStatus = ReservationStatusNormalizer.Normalize(requestedStatus);
        var now = DateTime.UtcNow;
        var reservation = new Reservation
        {
            ReservationNumber = reservationNumber,
            ClientId = currentUser.UserId,
            GuestId = request.GuestId,
            PropertyId = request.PropertyId,
            RoomTypeId = request.RoomTypeId,
            RoomId = room.Id,
            CheckInDate = request.CheckInDate,
            CheckOutDate = request.CheckOutDate,
            AdultCount = pricePreview.Adults,
            ChildCount = pricePreview.Children,
            TotalPrice = pricePreview.FinalAmount,
            BaseAmount = pricePreview.BaseAmount,
            DiscountAmount = pricePreview.DiscountAmount,
            ExtraGuestAmount = pricePreview.ExtraGuestAmount,
            ServiceFeeAmount = pricePreview.ServiceFeeAmount,
            FinalAmount = pricePreview.FinalAmount,
            Currency = pricePreview.Currency,
            Status = requestedStatus,
            ConfirmedAtUtc = requestedStatus == ReservationStatus.Confirmed ? now : null,
            Source = GetReservationSource(currentUser.Role),
            GuestNote = request.Notes
        };

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        await LockRoomTypeAsync(request.RoomTypeId, cancellationToken);
        availability = await availabilityService.GetAvailabilityAsync(
            request.PropertyId,
            request.RoomTypeId,
            request.CheckInDate,
            request.CheckOutDate,
            roomCount,
            excludedReservationId: null,
            cancellationToken: cancellationToken);
        ValidateAvailabilityForCreate(availability, roomCount);
        isOnRequest = availability.HasOnRequestNight;
        requestedStatus = request.Status ?? (isOnRequest
            ? ReservationStatus.PendingApproval
            : ReservationStatus.Pending);
        statusWorkflow.ValidateManualCreationStatus(isOnRequest, requestedStatus);
        reservation.Status = ReservationStatusNormalizer.Normalize(requestedStatus);
        reservation.ConfirmedAtUtc = reservation.Status == ReservationStatus.Confirmed
            ? now
            : null;
        await ValidateFinalCapacityAsync(
            request.RoomTypeId,
            request.CheckInDate,
            request.CheckOutDate,
            selectedRoomIds,
            excludedReservationId: null,
            cancellationToken: cancellationToken);

        dbContext.Reservations.Add(reservation);
        await dbContext.SaveChangesAsync(cancellationToken);

        await notificationService.SendAsync(
            CreateNotificationRequest(reservation, request, guest, isOnRequest),
            cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return ToResponse(reservation, property, roomType, guest, request, pricePreview);
    }

    public async Task<ReservationResponse> UpdateAsync(
        int reservationId,
        ReservationUpdateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        EnsureAdminUser(currentUser.Role);
        ValidateDateRange(request.CheckInDate, request.CheckOutDate);

        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Room)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (reservation.Status == ReservationStatus.Cancelled)
        {
            throw new InvalidOperationException("Cancelled reservations cannot be edited.");
        }

        if (IsLockedForFullEdit(reservation.Status))
        {
            EnsureLockedReservationOnlyNotes(reservation, request);
            var lockedStatusNotification = await ApplyRequestedStatusTransitionAsync(
                reservation,
                request.Status,
                currentUser,
                cancellationToken);
            reservation.GuestNote = request.Notes;
            reservation.UpdatedAtUtc = DateTime.UtcNow;
            reservation.UpdatedByUserId = currentUser.UserId;
            await using var lockedTransaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            await SendStatusNotificationAsync(
                reservation,
                lockedStatusNotification,
                cancellationToken);
            await lockedTransaction.CommitAsync(cancellationToken);
            return ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
        }

        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .SingleOrDefaultAsync(item =>
                    item.Id == request.RoomTypeId &&
                    item.PropertyId == reservation.PropertyId &&
                    item.IsActive,
                cancellationToken)
            ?? throw new KeyNotFoundException("Room type not found.");

        var guest = await dbContext.Guests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == request.GuestId, cancellationToken)
            ?? throw new KeyNotFoundException("Guest not found.");

        var selectedRoomIds = request.RoomIds.Distinct().ToList();
        var roomCount = selectedRoomIds.Count > 0 ? selectedRoomIds.Count : request.RoomCount;

        if (selectedRoomIds.Count > 0)
        {
            var validRoomCount = await dbContext.Rooms.AsNoTracking()
                .CountAsync(room =>
                        selectedRoomIds.Contains(room.Id) &&
                        room.RoomTypeId == request.RoomTypeId &&
                        room.IsActive,
                    cancellationToken);

            if (validRoomCount != selectedRoomIds.Count)
            {
                throw new ArgumentException("One or more selected rooms are invalid.");
            }
        }

        var availability = await availabilityService.GetAvailabilityAsync(
            reservation.PropertyId,
            request.RoomTypeId,
            request.CheckInDate,
            request.CheckOutDate,
            roomCount,
            excludedReservationId: reservationId,
            cancellationToken: cancellationToken);
        ValidateAvailabilityForCreate(availability, roomCount);
        await ValidateFinalCapacityAsync(
            request.RoomTypeId,
            request.CheckInDate,
            request.CheckOutDate,
            selectedRoomIds,
            excludedReservationId: reservationId,
            cancellationToken: cancellationToken);

        var pricePreview = await pricingService.PreviewReservationPriceAsync(
            new ReservationPricePreviewRequest
            {
                PropertyId = reservation.PropertyId,
                RoomTypeId = request.RoomTypeId,
                CheckInDate = request.CheckInDate,
                CheckOutDate = request.CheckOutDate,
                Adults = request.Adults,
                Children = request.Children,
                ChildAges = request.ChildAges,
                RoomCount = roomCount,
                GuestType = request.GuestType
            },
            cancellationToken);

        reservation.GuestId = request.GuestId;
        reservation.RoomTypeId = request.RoomTypeId;
        reservation.RoomId = selectedRoomIds.Count > 0 ? selectedRoomIds[0] : null;
        reservation.CheckInDate = request.CheckInDate;
        reservation.CheckOutDate = request.CheckOutDate;
        reservation.AdultCount = pricePreview.Adults;
        reservation.ChildCount = pricePreview.Children;
        reservation.TotalPrice = pricePreview.FinalAmount;
        reservation.BaseAmount = pricePreview.BaseAmount;
        reservation.DiscountAmount = pricePreview.DiscountAmount;
        reservation.ExtraGuestAmount = pricePreview.ExtraGuestAmount;
        reservation.ServiceFeeAmount = pricePreview.ServiceFeeAmount;
        reservation.FinalAmount = pricePreview.FinalAmount + reservation.ManualAdjustment;
        reservation.Currency = pricePreview.Currency;
        reservation.GuestNote = request.Notes;
        reservation.UpdatedAtUtc = DateTime.UtcNow;
        reservation.UpdatedByUserId = currentUser.UserId;

        var statusNotification = await ApplyRequestedStatusTransitionAsync(
            reservation,
            request.Status,
            currentUser,
            cancellationToken);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await SendStatusNotificationAsync(reservation, statusNotification, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var response = ToResponse(reservation, reservation.Property, roomType, guest);
        response.GuestType = request.GuestType;
        response.RoomCount = pricePreview.RoomCount;
        response.ChildAmount = pricePreview.ChildAmount;
        response.TaxAmount = pricePreview.TaxAmount;
        return response;
    }

    public async Task<ReservationResponse> ApproveAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations.AsNoTracking()
            .Where(item => item.Id == reservationId)
            .Select(item => new { item.PropertyId, item.Status })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (!await CanApproveAsync(
                currentUser.UserId,
                currentUser.Role,
                reservation.PropertyId,
                cancellationToken))
        {
            throw new UnauthorizedAccessException("You cannot approve this property's reservations.");
        }

        statusWorkflow.ValidateTransition(
            reservation.Status,
            ReservationStatus.ApprovedAwaitingPayment);

        return await UpdateStatusAsync(
            reservationId,
            new ReservationStatusUpdateRequest
            {
                Status = ReservationStatus.ApprovedAwaitingPayment
            },
            currentUser,
            cancellationToken);
    }

    public async Task<ReservationResponse> CancelAsync(
        int reservationId,
        ReservationCancellationRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        EnsureAdminUser(currentUser.Role);
        if (!request.Reason.HasValue)
        {
            throw new ArgumentException("Cancellation reason is required.");
        }

        var explanation = request.Explanation?.Trim();
        if (request.Reason == ReservationCancellationReason.Other &&
            string.IsNullOrWhiteSpace(explanation))
        {
            throw new ArgumentException("Cancellation explanation is required when reason is Other.");
        }

        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        statusWorkflow.ValidateTransition(reservation.Status, ReservationStatus.Cancelled);

        var now = DateTime.UtcNow;
        reservation.Status = ReservationStatus.Cancelled;
        reservation.CancellationReason = request.Reason.Value;
        reservation.CancellationNote = string.IsNullOrWhiteSpace(explanation)
            ? null
            : explanation;
        reservation.CancelledAtUtc = now;
        reservation.CancelledByUserId = currentUser.UserId;
        reservation.ChangedAtUtc = now;
        reservation.ChangedByUserId = currentUser.UserId;

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await notificationService.SendAsync(
            CreateReservationNotificationRequest(
                reservation,
                NotificationEventType.ReservationCancelled,
                $"Reservation {reservation.ReservationNumber} was cancelled."),
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
    }

    public async Task<ReservationResponse> AdjustPriceAsync(
        int reservationId,
        ReservationPriceAdjustmentRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        EnsureAdminUser(currentUser.Role);
        if (request.Amount == 0)
        {
            throw new ArgumentException("Manual adjustment must be positive or negative.");
        }

        var reservation = await ReservationQuery()
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (reservation.Status == ReservationStatus.Cancelled)
        {
            throw new InvalidOperationException("Cancelled reservations are read-only.");
        }

        var finalAmount = reservation.TotalPrice + request.Amount;
        if (finalAmount < 0 || finalAmount > MaximumStoredAmount)
        {
            throw new ArgumentException("Final reservation amount is outside the supported range.");
        }

        var oldValue = reservation.ManualAdjustment;
        if (oldValue == request.Amount)
        {
            throw new ArgumentException("Manual adjustment has not changed.");
        }

        reservation.ManualAdjustment = request.Amount;
        reservation.FinalAmount = finalAmount;
        reservation.UpdatedByUserId = currentUser.UserId;
        auditLogService.Add(
            currentUser.UserId,
            AuditAction.PriceChanged,
            nameof(Reservation),
            reservation.Id,
            reservation.PropertyId,
            reservation.ReservationNumber,
            JsonSerializer.Serialize(new ManualAdjustmentAuditEntry(oldValue, request.Amount)));

        await dbContext.SaveChangesAsync(cancellationToken);

        var response = ToResponse(
            reservation,
            reservation.Property,
            reservation.RoomType,
            reservation.Guest);
        response.Timeline = await BuildTimelineAsync(reservation, cancellationToken);
        return response;
    }

    public Task<bool> ExpirePaymentWindowAsync(
        int reservationId,
        CancellationToken cancellationToken = default) =>
        ExpirePaymentWindowAtAsync(reservationId, DateTime.UtcNow, cancellationToken);

    public async Task<int> ExpireApprovedUnpaidReservationsAsync(
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var reservationIds = await dbContext.Reservations.AsNoTracking()
            .Where(reservation =>
                reservation.Status == ReservationStatus.ApprovedAwaitingPayment &&
                reservation.PaymentExpiresAtUtc.HasValue &&
                reservation.PaymentExpiresAtUtc.Value < now &&
                !reservation.PaidAtUtc.HasValue &&
                (reservation.Payments
                    .Where(payment => payment.Status == PaymentStatus.Successful)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0) < reservation.FinalAmount)
            .Select(reservation => reservation.Id)
            .ToListAsync(cancellationToken);

        var expiredCount = 0;
        foreach (var reservationId in reservationIds)
        {
            if (await ExpirePaymentWindowAtAsync(reservationId, now, cancellationToken))
            {
                expiredCount++;
            }
        }

        return expiredCount;
    }

    private async Task<bool> ExpirePaymentWindowAtAsync(
        int reservationId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser)
            .Include(item => item.Payments)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        var paidAmount = reservation.Payments
            .Where(payment => payment.Status == PaymentStatus.Successful)
            .Sum(payment => payment.Amount);
        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment ||
            reservation.PaymentExpiresAtUtc is null ||
            reservation.PaymentExpiresAtUtc >= now ||
            reservation.PaidAtUtc.HasValue ||
            paidAmount >= reservation.FinalAmount)
        {
            return false;
        }

        reservation.Status = ReservationStatus.PaymentExpired;
        reservation.ExpiredAtUtc = now;
        reservation.ChangedAtUtc = now;
        reservation.ChangedByUserId = null;

        await InvalidateUnusedPaymentTokensAsync(
            reservation.Id,
            now,
            userId: null,
            cancellationToken);

        auditLogService.Add(
            reservation.ClientId,
            AuditAction.BookingExpired,
            nameof(Reservation),
            reservation.Id,
            reservation.PropertyId,
            reservation.ReservationNumber,
            "System marked the unpaid reservation as payment expired.");

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await notificationService.SendAsync(
            CreateReservationNotificationRequest(
                reservation,
                NotificationEventType.ReservationPaymentExpired,
                $"Payment window expired for reservation {reservation.ReservationNumber}."),
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return true;
    }

    private async Task<Reservation> ExpireAndReloadIfNeededAsync(
        Reservation reservation,
        CancellationToken cancellationToken)
    {
        if (!await ExpirePaymentWindowAsync(reservation.Id, cancellationToken))
        {
            return reservation;
        }

        return await ReservationQuery()
            .SingleAsync(item => item.Id == reservation.Id, cancellationToken);
    }

    private async Task<(NotificationEventType EventType, string Message)?> ApplyRequestedStatusTransitionAsync(
        Reservation reservation,
        ReservationStatus? requestedStatus,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken)
    {
        if (!requestedStatus.HasValue ||
            ReservationStatusNormalizer.Normalize(requestedStatus.Value) ==
            ReservationStatusNormalizer.Normalize(reservation.Status))
        {
            return null;
        }

        return await ApplyStatusTransitionAsync(
            reservation,
            ReservationStatusNormalizer.Normalize(requestedStatus.Value),
            currentUser,
            cancellationToken);
    }

    private async Task<(NotificationEventType EventType, string Message)?> ApplyStatusTransitionAsync(
        Reservation reservation,
        ReservationStatus targetStatus,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken)
    {
        EnsureStatusManager(currentUser.Role);
        if (targetStatus == ReservationStatus.Cancelled)
        {
            throw new InvalidOperationException("Use the reservation cancellation endpoint to cancel a reservation.");
        }

        statusWorkflow.ValidateTransition(reservation.Status, targetStatus);

        var now = DateTime.UtcNow;
        if (targetStatus == ReservationStatus.PaymentExpired &&
            (reservation.PaymentExpiresAtUtc is null || reservation.PaymentExpiresAtUtc > now))
        {
            throw new InvalidOperationException("Payment deadline has not expired yet.");
        }
        if (targetStatus == ReservationStatus.PaymentExpired)
        {
            var paidAmount = await dbContext.Payments.AsNoTracking()
                .Where(payment =>
                    payment.ReservationId == reservation.Id &&
                    payment.Status == PaymentStatus.Successful)
                .SumAsync(payment => (decimal?)payment.Amount, cancellationToken) ?? 0;
            if (reservation.PaidAtUtc.HasValue || paidAmount >= reservation.FinalAmount)
            {
                throw new InvalidOperationException("Paid reservations cannot be marked as payment expired.");
            }
        }

        reservation.Status = targetStatus;
        reservation.ChangedAtUtc = now;
        reservation.ChangedByUserId = currentUser.UserId;

        switch (targetStatus)
        {
            case ReservationStatus.Confirmed:
                reservation.ConfirmedAtUtc ??= now;
                break;
            case ReservationStatus.Paid:
                reservation.PaidAtUtc ??= now;
                reservation.ConfirmedAtUtc ??= now;
                break;
            case ReservationStatus.PaymentExpired:
                reservation.ExpiredAtUtc ??= now;
                await InvalidateUnusedPaymentTokensAsync(
                    reservation.Id,
                    now,
                    currentUser.UserId,
                    cancellationToken);
                auditLogService.Add(
                    currentUser.UserId,
                    AuditAction.BookingExpired,
                    nameof(Reservation),
                    reservation.Id,
                    reservation.PropertyId,
                    reservation.ReservationNumber,
                    "Reservation payment window expired.");
                break;
            case ReservationStatus.ApprovedAwaitingPayment:
                reservation.ApprovedAtUtc = now;
                reservation.ApprovedByUserId = currentUser.UserId;
                reservation.PaymentExpiresAtUtc = now.AddMinutes(
                    await GetPaymentWindowMinutesAsync(cancellationToken));
                auditLogService.Add(
                    currentUser.UserId,
                    AuditAction.BookingApproved,
                    nameof(Reservation),
                    reservation.Id,
                    reservation.PropertyId,
                    reservation.ReservationNumber,
                    $"Reservation {reservation.ReservationNumber} was approved and is awaiting payment.");
                break;
        }

        return TryGetStatusNotification(targetStatus, out var eventType, out var message)
            ? (eventType, string.Format(message, reservation.ReservationNumber))
            : null;
    }

    private async Task InvalidateUnusedPaymentTokensAsync(
        int reservationId,
        DateTime invalidatedAtUtc,
        int? userId,
        CancellationToken cancellationToken)
    {
        var unusedPaymentTokens = await dbContext.ReservationPaymentLinkTokens
            .Where(token =>
                token.ReservationId == reservationId &&
                token.UsedAtUtc == null)
            .ToListAsync(cancellationToken);
        foreach (var token in unusedPaymentTokens)
        {
            token.UsedAtUtc = invalidatedAtUtc;
            token.UpdatedAtUtc = invalidatedAtUtc;
            token.UpdatedByUserId = userId;
        }
    }

    private async Task SendStatusNotificationAsync(
        Reservation reservation,
        (NotificationEventType EventType, string Message)? notification,
        CancellationToken cancellationToken)
    {
        if (!notification.HasValue) return;

        await notificationService.SendAsync(
            CreateReservationNotificationRequest(
                reservation,
                notification.Value.EventType,
                notification.Value.Message),
            cancellationToken);
    }

    public async Task<ReservationResponse> UpdateStatusAsync(
        int reservationId,
        ReservationStatusUpdateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        var targetStatus = ReservationStatusNormalizer.Normalize(request.Status);
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        var statusNotification = await ApplyStatusTransitionAsync(
            reservation,
            targetStatus,
            currentUser,
            cancellationToken);

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await SendStatusNotificationAsync(reservation, statusNotification, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
        response.Timeline = await BuildTimelineAsync(reservation, cancellationToken);
        return response;
    }

    public async Task<ReservationPaymentLinkResponse> GeneratePaymentLinkAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        EnsurePaymentLinkManager(currentUser.Role);
        var reservation = await dbContext.Reservations
            .Include(item => item.Payments)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment)
        {
            throw new InvalidOperationException("Payment link can only be generated for reservations awaiting payment.");
        }

        if (string.IsNullOrWhiteSpace(reservation.ReservationNumber))
        {
            throw new InvalidOperationException("Reservation number is required to generate a payment link.");
        }

        var now = DateTime.UtcNow;
        if (reservation.PaymentExpiresAtUtc is null || reservation.PaymentExpiresAtUtc <= now)
        {
            throw new InvalidOperationException("Payment link cannot be generated because the payment window has expired.");
        }

        var paidAmount = reservation.Payments
            .Where(payment => payment.Status == PaymentStatus.Successful)
            .Sum(payment => payment.Amount);
        if (reservation.PaidAtUtc.HasValue ||
            reservation.Status == ReservationStatus.Paid ||
            paidAmount >= reservation.FinalAmount)
        {
            throw new InvalidOperationException("Payment link cannot be generated for a paid reservation.");
        }

        var activeTokens = await dbContext.ReservationPaymentLinkTokens
            .Where(token =>
                token.ReservationId == reservation.Id &&
                token.UsedAtUtc == null &&
                token.ExpiresAtUtc > now)
            .ToListAsync(cancellationToken);
        foreach (var token in activeTokens)
        {
            token.UsedAtUtc = now;
            token.UpdatedAtUtc = now;
            token.UpdatedByUserId = currentUser.UserId;
        }

        var rawToken = CreateRawToken();
        var paymentLinkToken = new ReservationPaymentLinkToken
        {
            ReservationId = reservation.Id,
            TokenHash = HashToken(rawToken),
            ExpiresAtUtc = reservation.PaymentExpiresAtUtc.Value,
            CreatedByUserId = currentUser.UserId
        };

        dbContext.ReservationPaymentLinkTokens.Add(paymentLinkToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return new ReservationPaymentLinkResponse
        {
            ReservationId = reservation.Id,
            ReservationNumber = reservation.ReservationNumber,
            PaymentLink = $"/account/reservations/{Uri.EscapeDataString(reservation.ReservationNumber)}/payment?token={Uri.EscapeDataString(rawToken)}",
            ExpiresAtUtc = paymentLinkToken.ExpiresAtUtc
        };
    }

    public async Task<ReservationPaymentLinkResponse> SendPaymentLinkAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        var paymentLink = await GeneratePaymentLinkAsync(reservationId, currentUser, cancellationToken);
        var reservation = await dbContext.Reservations
            .AsNoTracking()
            .Include(item => item.Guest)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        await notificationService.SendAsync(
            new NotificationRequest
            {
                EventType = NotificationEventType.ReservationPaymentLinkCreated,
                RecipientUserId = reservation.ClientId,
                RecipientGuestId = reservation.GuestId,
                Mobile = reservation.Guest?.Mobile,
                Email = reservation.Guest?.Email,
                Subject = reservation.ReservationNumber,
                Message = $"Payment link was created for reservation {reservation.ReservationNumber}.",
                DataJson = JsonSerializer.Serialize(new
                {
                    reservationId = reservation.Id,
                    reservationNumber = reservation.ReservationNumber,
                    reservation.PropertyId,
                    reservation.RoomTypeId,
                    reservation.GuestId,
                    paymentLink = paymentLink.PaymentLink,
                    paymentLink.ExpiresAtUtc
                }),
                Channels = NotificationChannel.Sms | NotificationChannel.Email
            },
            cancellationToken);

        return new ReservationPaymentLinkResponse
        {
            ReservationId = paymentLink.ReservationId,
            ReservationNumber = paymentLink.ReservationNumber,
            PaymentLink = hostEnvironment.IsDevelopment() ? paymentLink.PaymentLink : string.Empty,
            DevPaymentLink = hostEnvironment.IsDevelopment() ? paymentLink.PaymentLink : null,
            ExpiresAtUtc = paymentLink.ExpiresAtUtc
        };
    }

    private static void ValidateDateRange(DateOnly checkInDate, DateOnly checkOutDate)
    {
        if (checkInDate >= checkOutDate)
        {
            throw new ArgumentException("Check-in date must be before check-out date.");
        }
    }

    private static void ValidateAvailabilityForCreate(ReservationAvailabilityResult availability, int roomCount)
    {
        if (availability.Nights.Count == 0)
        {
            throw new InvalidOperationException("Reservation must include at least one night.");
        }

        foreach (var night in availability.Nights)
        {
            if (night.IsClosed || night.Status == AvailabilityStatus.Unavailable)
            {
                throw new InvalidOperationException("Room type is unavailable for the selected dates.");
            }

            if (night.Status == AvailabilityStatus.Available && night.AvailableCount < roomCount)
            {
                throw new InvalidOperationException("Not enough capacity for the selected dates.");
            }

            if (night.Status is not AvailabilityStatus.Available and not AvailabilityStatus.OnRequest)
            {
                throw new InvalidOperationException("Room type is unavailable for the selected dates.");
            }
        }
    }

    private async Task LockRoomTypeAsync(int roomTypeId, CancellationToken cancellationToken)
    {
        await dbContext.RoomTypes
            .FromSqlInterpolated($"SELECT * FROM RoomTypes WITH (UPDLOCK, HOLDLOCK) WHERE Id = {roomTypeId}")
            .AsNoTracking()
            .SingleAsync(cancellationToken);
    }

    private async Task ValidateFinalCapacityAsync(
        int roomTypeId,
        DateOnly checkInDate,
        DateOnly checkOutDate,
        IReadOnlyCollection<int> selectedRoomIds,
        int? excludedReservationId,
        CancellationToken cancellationToken)
    {
        var effectiveAvailability = await effectiveAvailabilityService.GetRangeAsync(
            [roomTypeId],
            checkInDate,
            checkOutDate,
            excludedReservationId,
            cancellationToken: cancellationToken);
        var claimedRoomIds = effectiveAvailability[roomTypeId].ClaimedRoomIds;
        if (selectedRoomIds.Any(claimedRoomIds.Contains))
        {
            throw CapacityChangedException();
        }
    }

    private static InvalidOperationException CapacityChangedException() =>
        new("Availability changed. There is no longer enough capacity for the selected dates.");

    private async Task<bool> CanApproveAsync(
        int userId,
        UserRole role,
        int propertyId,
        CancellationToken cancellationToken)
    {
        if (role is UserRole.SuperAdmin or UserRole.AdminAssistant)
        {
            return true;
        }

        return role is UserRole.Owner or UserRole.OwnerAssistant &&
               await permissionService.CanAsync(
                   userId,
                   propertyId,
                   "bookings.edit",
                   cancellationToken);
    }

    private async Task<int> GetPaymentWindowMinutesAsync(CancellationToken cancellationToken)
    {
        var configuredValue = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting =>
                setting.IsActive &&
                setting.Key == PaymentWindowMinutesSettingKey)
            .Select(setting => setting.Value)
            .SingleOrDefaultAsync(cancellationToken);

        return int.TryParse(
                   configuredValue,
                   NumberStyles.Integer,
                   CultureInfo.InvariantCulture,
                   out var minutes) &&
               minutes is > 0 and <= 10080
            ? minutes
            : DefaultPaymentWindowMinutes;
    }

    private static void EnsureAdminUser(UserRole role)
    {
        if (role is not (UserRole.SuperAdmin or UserRole.AdminAssistant))
        {
            throw new UnauthorizedAccessException("Only admin or admin-assistant users can modify reservations.");
        }
    }

    private static void EnsureStatusManager(UserRole role)
    {
        if (role is not (UserRole.SuperAdmin or
            UserRole.AdminAssistant or
            UserRole.Owner or
            UserRole.OwnerAssistant))
        {
            throw new UnauthorizedAccessException("You cannot change reservation status.");
        }
    }

    private static void EnsurePaymentLinkManager(UserRole role)
    {
        if (role is not (UserRole.SuperAdmin or
            UserRole.AdminAssistant or
            UserRole.Owner or
            UserRole.OwnerAssistant))
        {
            throw new UnauthorizedAccessException("You cannot generate reservation payment links.");
        }
    }

    private static bool IsLockedForFullEdit(ReservationStatus status) =>
        status is ReservationStatus.Paid or ReservationStatus.Completed;

    private static void EnsureLockedReservationOnlyNotes(
        Reservation reservation,
        ReservationUpdateRequest request)
    {
        var selectedRoomIds = request.RoomIds.Distinct().ToList();
        var selectedRoomId = selectedRoomIds.Count > 0 ? selectedRoomIds[0] : (int?)null;

        var changesRestrictedFields =
            request.GuestId != reservation.GuestId ||
            request.RoomTypeId != reservation.RoomTypeId ||
            selectedRoomId != reservation.RoomId ||
            request.CheckInDate != reservation.CheckInDate ||
            request.CheckOutDate != reservation.CheckOutDate ||
            request.Adults != reservation.AdultCount ||
            request.Children != reservation.ChildCount;

        if (changesRestrictedFields)
        {
            throw new InvalidOperationException("Paid or confirmed reservations can only update notes.");
        }
    }

    private static ReservationSource GetReservationSource(UserRole role) =>
        role is UserRole.Owner or UserRole.OwnerAssistant
            ? ReservationSource.OwnerManual
            : ReservationSource.AdminCreated;

    private IQueryable<Reservation> ReservationQuery() =>
        dbContext.Reservations
            .AsNoTracking()
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Room)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser);

    private async Task<IReadOnlyList<ReservationTimelineEventResponse>> BuildTimelineAsync(
        Reservation reservation,
        CancellationToken cancellationToken)
    {
        var paymentLinks = await dbContext.ReservationPaymentLinkTokens.AsNoTracking()
            .Where(token => token.ReservationId == reservation.Id)
            .Select(token => new
            {
                token.CreatedAtUtc,
                token.CreatedByUserId
            })
            .ToListAsync(cancellationToken);
        var successfulPayments = await dbContext.Payments.AsNoTracking()
            .Where(payment =>
                payment.ReservationId == reservation.Id &&
                payment.Status == PaymentStatus.Successful)
            .Select(payment => new
            {
                TimestampUtc = payment.PaidAtUtc ?? payment.CreatedAtUtc,
                payment.CreatedByUserId
            })
            .OrderBy(payment => payment.TimestampUtc)
            .ToListAsync(cancellationToken);
        var auditLogs = await dbContext.AuditLogs.AsNoTracking()
            .Where(log =>
                log.EntityType == nameof(Reservation) &&
                log.EntityId == reservation.Id &&
                (log.Action == AuditAction.BookingConfirmed ||
                 log.Action == AuditAction.BookingCancelled ||
                 log.Action == AuditAction.PriceChanged))
            .Select(log => new
            {
                log.Action,
                log.UserId,
                log.OccurredAtUtc,
                log.Description
            })
            .ToListAsync(cancellationToken);

        var userIds = paymentLinks
            .Select(item => item.CreatedByUserId)
            .Concat(successfulPayments.Select(item => item.CreatedByUserId))
            .Concat(auditLogs.Select(item => (int?)item.UserId))
            .Append(reservation.CreatedByUserId ?? reservation.ClientId)
            .Append(reservation.UpdatedByUserId)
            .Append(reservation.ChangedByUserId)
            .Append(reservation.ApprovedByUserId)
            .Append(reservation.CancelledByUserId)
            .Where(userId => userId.HasValue)
            .Select(userId => userId!.Value)
            .Distinct()
            .ToList();
        var actors = await dbContext.Users.AsNoTracking()
            .Where(user => userIds.Contains(user.Id))
            .Select(user => new
            {
                user.Id,
                user.FirstName,
                user.LastName,
                user.Email
            })
            .ToDictionaryAsync(
                user => user.Id,
                user => (user.FirstName + " " + user.LastName).Trim() == ""
                    ? user.Email
                    : (user.FirstName + " " + user.LastName).Trim(),
                cancellationToken);

        string? ActorName(int? userId) =>
            userId.HasValue && actors.TryGetValue(userId.Value, out var actor)
                ? actor
                : null;

        var events = new List<ReservationTimelineEventResponse>();
        var createdByUserId = reservation.CreatedByUserId ?? reservation.ClientId;
        events.Add(new ReservationTimelineEventResponse
        {
            Type = ReservationTimelineEventType.Created,
            TimestampUtc = reservation.CreatedAtUtc,
            ActorUserId = createdByUserId,
            Actor = ActorName(createdByUserId) ?? FormatUserName(reservation.Client)
        });

        if (reservation.UpdatedAtUtc.HasValue &&
            reservation.UpdatedAtUtc.Value > reservation.CreatedAtUtc &&
            !IsLifecycleTimestamp(reservation, reservation.UpdatedAtUtc.Value) &&
            !auditLogs.Any(log =>
                log.Action == AuditAction.PriceChanged &&
                SameTimestamp(reservation.UpdatedAtUtc.Value, log.OccurredAtUtc)))
        {
            var updatedByUserId = reservation.UpdatedByUserId ?? reservation.ChangedByUserId;
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.Updated,
                TimestampUtc = reservation.UpdatedAtUtc.Value,
                ActorUserId = updatedByUserId,
                Actor = ActorName(updatedByUserId)
            });
        }

        if (reservation.ApprovedAtUtc.HasValue)
        {
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.Approved,
                TimestampUtc = reservation.ApprovedAtUtc.Value,
                ActorUserId = reservation.ApprovedByUserId,
                Actor = ActorName(reservation.ApprovedByUserId) ??
                        FormatUserName(reservation.ApprovedByUser)
            });
        }

        events.AddRange(paymentLinks.Select(link => new ReservationTimelineEventResponse
        {
            Type = ReservationTimelineEventType.PaymentLinkCreated,
            TimestampUtc = link.CreatedAtUtc,
            ActorUserId = link.CreatedByUserId,
            Actor = ActorName(link.CreatedByUserId)
        }));

        if (reservation.PaidAtUtc.HasValue)
        {
            var payment = successfulPayments
                .OrderBy(item => Math.Abs((item.TimestampUtc - reservation.PaidAtUtc.Value).Ticks))
                .FirstOrDefault();
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.Paid,
                TimestampUtc = reservation.PaidAtUtc.Value,
                ActorUserId = payment?.CreatedByUserId,
                Actor = ActorName(payment?.CreatedByUserId)
            });
        }

        if (reservation.ConfirmedAtUtc.HasValue &&
            !SameTimestamp(reservation.ConfirmedAtUtc.Value, reservation.PaidAtUtc))
        {
            var changedByUserId = SameTimestamp(
                reservation.ConfirmedAtUtc.Value,
                reservation.ChangedAtUtc)
                ? reservation.ChangedByUserId
                : null;
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.StatusChanged,
                TimestampUtc = reservation.ConfirmedAtUtc.Value,
                ActorUserId = changedByUserId,
                Actor = ActorName(changedByUserId),
                Status = ReservationStatus.Confirmed
            });
        }

        if (reservation.ChangedAtUtc.HasValue &&
            !SameTimestamp(reservation.ChangedAtUtc.Value, reservation.ApprovedAtUtc) &&
            !SameTimestamp(reservation.ChangedAtUtc.Value, reservation.PaidAtUtc) &&
            !SameTimestamp(reservation.ChangedAtUtc.Value, reservation.ConfirmedAtUtc) &&
            !SameTimestamp(reservation.ChangedAtUtc.Value, reservation.CancelledAtUtc))
        {
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.StatusChanged,
                TimestampUtc = reservation.ChangedAtUtc.Value,
                ActorUserId = reservation.ChangedByUserId,
                Actor = ActorName(reservation.ChangedByUserId),
                Status = ReservationStatusNormalizer.Normalize(reservation.Status)
            });
        }

        foreach (var auditLog in auditLogs.Where(log =>
                     log.Action == AuditAction.BookingConfirmed &&
                     !events.Any(item =>
                         item.Type == ReservationTimelineEventType.StatusChanged &&
                         SameTimestamp(item.TimestampUtc, log.OccurredAtUtc))))
        {
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.StatusChanged,
                TimestampUtc = auditLog.OccurredAtUtc,
                ActorUserId = auditLog.UserId,
                Actor = ActorName(auditLog.UserId),
                Status = ReservationStatus.Confirmed,
                Note = auditLog.Description
            });
        }

        foreach (var auditLog in auditLogs.Where(log => log.Action == AuditAction.PriceChanged))
        {
            var change = ParseManualAdjustmentAuditEntry(auditLog.Description);
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.PriceAdjusted,
                TimestampUtc = auditLog.OccurredAtUtc,
                ActorUserId = auditLog.UserId,
                Actor = ActorName(auditLog.UserId),
                OldAmount = change?.OldValue,
                NewAmount = change?.NewValue
            });
        }

        if (reservation.CancelledAtUtc.HasValue)
        {
            events.Add(new ReservationTimelineEventResponse
            {
                Type = ReservationTimelineEventType.Cancelled,
                TimestampUtc = reservation.CancelledAtUtc.Value,
                ActorUserId = reservation.CancelledByUserId,
                Actor = ActorName(reservation.CancelledByUserId),
                CancellationReason = reservation.CancellationReason,
                Note = reservation.CancellationNote
            });
        }
        else
        {
            events.AddRange(auditLogs
                .Where(log => log.Action == AuditAction.BookingCancelled)
                .Select(log => new ReservationTimelineEventResponse
                {
                    Type = ReservationTimelineEventType.Cancelled,
                    TimestampUtc = log.OccurredAtUtc,
                    ActorUserId = log.UserId,
                    Actor = ActorName(log.UserId),
                    Note = log.Description
                }));
        }

        return events
            .OrderBy(item => item.TimestampUtc)
            .ThenBy(item => item.Type)
            .ToList();
    }

    private static bool IsLifecycleTimestamp(Reservation reservation, DateTime timestamp) =>
        SameTimestamp(timestamp, reservation.ApprovedAtUtc) ||
        SameTimestamp(timestamp, reservation.PaidAtUtc) ||
        SameTimestamp(timestamp, reservation.ConfirmedAtUtc) ||
        SameTimestamp(timestamp, reservation.CancelledAtUtc) ||
        SameTimestamp(timestamp, reservation.ChangedAtUtc);

    private static bool SameTimestamp(DateTime timestamp, DateTime? other) =>
        other.HasValue && Math.Abs((timestamp - other.Value).TotalSeconds) < 1;

    private static ManualAdjustmentAuditEntry? ParseManualAdjustmentAuditEntry(string? description)
    {
        if (string.IsNullOrWhiteSpace(description)) return null;

        try
        {
            return JsonSerializer.Deserialize<ManualAdjustmentAuditEntry>(description);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<PagedResult<ReservationListItemResponse>> SearchInternalAsync(
        ReservationListQuery query,
        int? scopedPropertyId,
        int? scopedGuestId,
        CancellationToken cancellationToken)
    {
        await ExpireApprovedUnpaidReservationsAsync(cancellationToken);
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var reservations = ApplyFilters(dbContext.Reservations.AsNoTracking(), query, scopedPropertyId, scopedGuestId);
        var totalCount = await reservations.CountAsync(cancellationToken);
        var rows = await ApplySort(reservations, query.Sort)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(reservation => new ReservationListProjection
            {
                Id = reservation.Id,
                ReservationNumber = reservation.ReservationNumber,
                PropertyId = reservation.PropertyId,
                PropertyName = reservation.Property.Name,
                RoomTypeId = reservation.RoomTypeId,
                RoomTypeName = reservation.RoomType.Name,
                RoomId = reservation.RoomId,
                RoomName = reservation.Room == null ? null : reservation.Room.Name,
                GuestId = reservation.GuestId,
                GuestFirstName = reservation.Guest == null ? null : reservation.Guest.FirstName,
                GuestLastName = reservation.Guest == null ? null : reservation.Guest.LastName,
                GuestMobile = reservation.Guest == null ? null : reservation.Guest.Mobile,
                CheckInDate = reservation.CheckInDate,
                CheckOutDate = reservation.CheckOutDate,
                Adults = reservation.AdultCount,
                Children = reservation.ChildCount,
                ManualAdjustment = reservation.ManualAdjustment,
                TotalPrice = reservation.TotalPrice,
                FinalAmount = reservation.FinalAmount,
                PaidAmount = reservation.Payments
                    .Where(payment => payment.Status == PaymentStatus.Successful)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0,
                Currency = reservation.Currency,
                Status = reservation.Status,
                Source = reservation.Source,
                CreatedAtUtc = reservation.CreatedAtUtc,
                PaidAtUtc = reservation.PaidAtUtc,
                PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc
            })
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        return new PagedResult<ReservationListItemResponse>
        {
            Items = rows.Select(row => ToListItemResponse(row, now)).ToList(),
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    private static IQueryable<Reservation> ApplyFilters(
        IQueryable<Reservation> query,
        ReservationListQuery filters,
        int? scopedPropertyId,
        int? scopedGuestId)
    {
        if (scopedGuestId.HasValue)
        {
            query = query.Where(reservation => reservation.GuestId == scopedGuestId.Value);
        }

        if (scopedPropertyId.HasValue)
        {
            query = query.Where(reservation => reservation.PropertyId == scopedPropertyId.Value);
        }
        else if (filters.PropertyId.HasValue)
        {
            query = query.Where(reservation => reservation.PropertyId == filters.PropertyId.Value);
        }

        if (filters.Status.HasValue)
        {
            var status = ReservationStatusNormalizer.Normalize(filters.Status.Value);
            query = status switch
            {
                ReservationStatus.PendingApproval => query.Where(reservation =>
                    reservation.Status == ReservationStatus.PendingApproval ||
                    reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval),
                ReservationStatus.PaymentExpired => query.Where(reservation =>
                    reservation.Status == ReservationStatus.PaymentExpired ||
                    reservation.Status == ReservationStatusNormalizer.LegacyPaymentExpired),
                _ => query.Where(reservation => reservation.Status == status)
            };
        }

        if (!string.IsNullOrWhiteSpace(filters.ReservationNumber))
        {
            var reservationNumber = filters.ReservationNumber.Trim();
            query = query.Where(reservation =>
                reservation.ReservationNumber != null &&
                reservation.ReservationNumber.Contains(reservationNumber));
        }

        if (filters.RoomTypeId.HasValue)
        {
            query = query.Where(reservation => reservation.RoomTypeId == filters.RoomTypeId.Value);
        }

        if (filters.RoomId.HasValue)
        {
            query = query.Where(reservation => reservation.RoomId == filters.RoomId.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.RoomSearch))
        {
            var search = filters.RoomSearch.Trim();
            query = query.Where(reservation =>
                reservation.RoomType.Name.Contains(search) ||
                reservation.Room != null &&
                (reservation.Room.Name.Contains(search) ||
                 reservation.Room.EnglishName != null && reservation.Room.EnglishName.Contains(search)));
        }

        if (!string.IsNullOrWhiteSpace(filters.GuestSearch))
        {
            var search = filters.GuestSearch.Trim();
            query = query.Where(reservation =>
                reservation.Guest != null &&
                (reservation.Guest.FirstName.Contains(search) ||
                 reservation.Guest.LastName.Contains(search) ||
                 reservation.Guest.Mobile != null && reservation.Guest.Mobile.Contains(search) ||
                 reservation.Guest.Email != null && reservation.Guest.Email.Contains(search)));
        }

        if (filters.BookingMode.HasValue)
        {
            query = filters.BookingMode.Value == ReservationBookingModeFilter.OnRequest
                ? query.Where(reservation =>
                    reservation.Status == ReservationStatus.PendingApproval ||
                    reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval ||
                    reservation.Status == ReservationStatus.ApprovedAwaitingPayment ||
                    reservation.Status == ReservationStatus.PaymentExpired ||
                    reservation.Status == ReservationStatusNormalizer.LegacyPaymentExpired ||
                    reservation.Status == ReservationStatus.CapacityLost)
                : query.Where(reservation =>
                    reservation.Status != ReservationStatus.PendingApproval &&
                    reservation.Status != ReservationStatusNormalizer.LegacyPendingApproval &&
                    reservation.Status != ReservationStatus.ApprovedAwaitingPayment &&
                    reservation.Status != ReservationStatus.PaymentExpired &&
                    reservation.Status != ReservationStatusNormalizer.LegacyPaymentExpired &&
                    reservation.Status != ReservationStatus.CapacityLost);
        }

        if (filters.CheckInFrom.HasValue)
        {
            query = query.Where(reservation => reservation.CheckInDate >= filters.CheckInFrom.Value);
        }

        if (filters.CheckInTo.HasValue)
        {
            query = query.Where(reservation => reservation.CheckInDate <= filters.CheckInTo.Value);
        }

        if (filters.CheckOutFrom.HasValue)
        {
            query = query.Where(reservation => reservation.CheckOutDate >= filters.CheckOutFrom.Value);
        }

        if (filters.CheckOutTo.HasValue)
        {
            query = query.Where(reservation => reservation.CheckOutDate <= filters.CheckOutTo.Value);
        }

        if (filters.CreatedFrom.HasValue)
        {
            query = query.Where(reservation => reservation.CreatedAtUtc >= filters.CreatedFrom.Value);
        }

        if (filters.CreatedTo.HasValue)
        {
            var createdTo = filters.CreatedTo.Value.TimeOfDay == TimeSpan.Zero
                ? filters.CreatedTo.Value.Date.AddDays(1).AddTicks(-1)
                : filters.CreatedTo.Value;
            query = query.Where(reservation => reservation.CreatedAtUtc <= createdTo);
        }

        if (filters.TotalPriceMin.HasValue)
        {
            query = query.Where(reservation => reservation.FinalAmount >= filters.TotalPriceMin.Value);
        }

        if (filters.TotalPriceMax.HasValue)
        {
            query = query.Where(reservation => reservation.FinalAmount <= filters.TotalPriceMax.Value);
        }

        if (filters.PaidAmountMin.HasValue)
        {
            query = query.Where(reservation =>
                (reservation.Payments
                    .Where(payment => payment.Status == PaymentStatus.Successful)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0) >= filters.PaidAmountMin.Value);
        }

        if (filters.PaidAmountMax.HasValue)
        {
            query = query.Where(reservation =>
                (reservation.Payments
                    .Where(payment => payment.Status == PaymentStatus.Successful)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0) <= filters.PaidAmountMax.Value);
        }

        if (filters.RemainingAmountMin.HasValue)
        {
            query = query.Where(reservation =>
                reservation.FinalAmount - (reservation.Payments
                    .Where(payment => payment.Status == PaymentStatus.Successful)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0) >= filters.RemainingAmountMin.Value);
        }

        if (filters.RemainingAmountMax.HasValue)
        {
            query = query.Where(reservation =>
                reservation.FinalAmount - (reservation.Payments
                    .Where(payment => payment.Status == PaymentStatus.Successful)
                    .Sum(payment => (decimal?)payment.Amount) ?? 0) <= filters.RemainingAmountMax.Value);
        }

        if (filters.Source.HasValue)
        {
            query = query.Where(reservation => reservation.Source == filters.Source.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.CreatedBy))
        {
            var search = filters.CreatedBy.Trim();
            query = query.Where(reservation =>
                reservation.Client.FirstName.Contains(search) ||
                reservation.Client.LastName.Contains(search) ||
                reservation.Client.Email.Contains(search) ||
                reservation.Client.PhoneNumber != null && reservation.Client.PhoneNumber.Contains(search));
        }

        if (filters.PaymentStatus.HasValue)
        {
            query = query.Where(reservation =>
                reservation.Payments.Any(payment => payment.Status == filters.PaymentStatus.Value));
        }

        if (filters.PaymentDeadlineFrom.HasValue)
        {
            query = query.Where(reservation =>
                reservation.PaymentExpiresAtUtc.HasValue &&
                reservation.PaymentExpiresAtUtc.Value >= filters.PaymentDeadlineFrom.Value);
        }

        if (filters.PaymentDeadlineTo.HasValue)
        {
            query = query.Where(reservation =>
                reservation.PaymentExpiresAtUtc.HasValue &&
                reservation.PaymentExpiresAtUtc.Value <= filters.PaymentDeadlineTo.Value);
        }

        return query;
    }

    private static IQueryable<Reservation> ApplySort(IQueryable<Reservation> query, string? sort)
    {
        return sort?.Trim().ToLowerInvariant() switch
        {
            "created" or "createdasc" => query.OrderBy(reservation => reservation.CreatedAtUtc),
            "checkin" or "checkinasc" => query.OrderBy(reservation => reservation.CheckInDate)
                .ThenBy(reservation => reservation.CreatedAtUtc),
            "checkindesc" => query.OrderByDescending(reservation => reservation.CheckInDate)
                .ThenByDescending(reservation => reservation.CreatedAtUtc),
            "status" or "statusasc" => query.OrderBy(reservation => reservation.Status)
                .ThenByDescending(reservation => reservation.CreatedAtUtc),
            "statusdesc" => query.OrderByDescending(reservation => reservation.Status)
                .ThenByDescending(reservation => reservation.CreatedAtUtc),
            "reservationnumber" or "reservationnumberasc" => query.OrderBy(reservation => reservation.ReservationNumber),
            "reservationnumberdesc" => query.OrderByDescending(reservation => reservation.ReservationNumber),
            _ => query.OrderByDescending(reservation => reservation.CreatedAtUtc)
        };
    }

    private static ReservationListItemResponse ToListItemResponse(Reservation reservation) =>
        new()
        {
            ReservationId = reservation.Id,
            Id = reservation.Id,
            ReservationNumber = reservation.ReservationNumber ?? string.Empty,
            PropertyId = reservation.PropertyId,
            PropertyName = reservation.Property.Name,
            RoomTypeId = reservation.RoomTypeId,
            RoomTypeName = reservation.RoomType.Name,
            RoomId = reservation.RoomId,
            RoomName = reservation.Room?.Name,
            GuestId = reservation.GuestId,
            GuestFullName = reservation.Guest?.FullName ?? string.Empty,
            GuestMobile = reservation.Guest?.Mobile,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Adults = reservation.AdultCount,
            Children = reservation.ChildCount,
            RoomCount = 1,
            CalculatedPrice = reservation.TotalPrice,
            ManualAdjustment = reservation.ManualAdjustment,
            FinalAmount = reservation.FinalAmount,
            TotalPrice = reservation.TotalPrice,
            PaidAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? reservation.FinalAmount
                : 0,
            RemainingAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? 0
                : reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = ReservationStatusNormalizer.Normalize(reservation.Status),
            Source = reservation.Source,
            CreatedAtUtc = reservation.CreatedAtUtc,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
            IsPaymentExpired = IsPaymentExpired(reservation.Status, reservation.PaymentExpiresAtUtc, DateTime.UtcNow),
            IsPaymentEligible = IsPaymentEligible(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                    ? 0
                    : reservation.FinalAmount,
                DateTime.UtcNow),
            RemainingPaymentSeconds = GetRemainingPaymentSeconds(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                DateTime.UtcNow)
        };

    private static ReservationListItemResponse ToListItemResponse(
        ReservationListProjection row,
        DateTime now)
    {
        var guestName = $"{row.GuestFirstName} {row.GuestLastName}".Trim();

        return new ReservationListItemResponse
        {
            ReservationId = row.Id,
            Id = row.Id,
            ReservationNumber = row.ReservationNumber ?? string.Empty,
            PropertyId = row.PropertyId,
            PropertyName = row.PropertyName,
            RoomTypeId = row.RoomTypeId,
            RoomTypeName = row.RoomTypeName,
            RoomId = row.RoomId,
            RoomName = row.RoomName,
            GuestId = row.GuestId,
            GuestFullName = guestName,
            GuestMobile = row.GuestMobile,
            CheckInDate = row.CheckInDate,
            CheckOutDate = row.CheckOutDate,
            NightsCount = row.CheckOutDate.DayNumber - row.CheckInDate.DayNumber,
            Adults = row.Adults,
            Children = row.Children,
            RoomCount = 1,
            CalculatedPrice = row.TotalPrice,
            ManualAdjustment = row.ManualAdjustment,
            TotalPrice = row.TotalPrice,
            FinalAmount = row.FinalAmount,
            PaidAmount = row.PaidAmount,
            RemainingAmount = Math.Max(0, row.FinalAmount - row.PaidAmount),
            Currency = row.Currency,
            Status = ReservationStatusNormalizer.Normalize(row.Status),
            Source = row.Source,
            CreatedAtUtc = row.CreatedAtUtc,
            PaymentExpiresAtUtc = row.PaymentExpiresAtUtc,
            IsPaymentExpired = IsPaymentExpired(row.Status, row.PaymentExpiresAtUtc, now),
            IsPaymentEligible = IsPaymentEligible(
                row.Status,
                row.PaymentExpiresAtUtc,
                Math.Max(0, row.FinalAmount - row.PaidAmount),
                now),
            RemainingPaymentSeconds = GetRemainingPaymentSeconds(row.Status, row.PaymentExpiresAtUtc, now)
        };
    }

    private static NotificationRequest CreateNotificationRequest(
        Reservation reservation,
        ReservationCreateRequest request,
        Guest guest,
        bool isOnRequest)
    {
        return new NotificationRequest
        {
            EventType = isOnRequest
                ? NotificationEventType.ReservationPendingApproval
                : NotificationEventType.ReservationCreated,
            RecipientUserId = reservation.ClientId,
            RecipientGuestId = request.GuestId,
            Mobile = guest.Mobile,
            Email = guest.Email,
            Subject = reservation.ReservationNumber,
            Message = $"Reservation {reservation.ReservationNumber} was created.",
            DataJson = JsonSerializer.Serialize(new
            {
                reservationId = reservation.Id,
                reservationNumber = reservation.ReservationNumber,
                reservation.PropertyId,
                reservation.RoomTypeId,
                reservation.GuestId,
                reservation.CheckInDate,
                reservation.CheckOutDate,
                isOnRequest
            }),
            Channels = NotificationChannel.InApp
        };
    }

    private ReservationResponse ToResponse(
        Reservation reservation,
        Property property,
        RoomType roomType,
        Guest guest,
        ReservationCreateRequest request,
        ReservationPricePreviewResponse pricePreview)
    {
        return new ReservationResponse
        {
            ReservationId = reservation.Id,
            Id = reservation.Id,
            ReservationNumber = reservation.ReservationNumber ?? string.Empty,
            PropertyId = reservation.PropertyId,
            PropertyName = property.Name,
            RoomTypeId = reservation.RoomTypeId,
            RoomTypeName = roomType.Name,
            RoomId = reservation.RoomId,
            RoomName = reservation.Room?.Name,
            GuestId = reservation.GuestId,
            GuestFullName = guest.FullName,
            GuestMobile = guest.Mobile,
            GuestEmail = guest.Email,
            GuestNationalCode = guest.NationalCode,
            GuestPassportNumber = guest.PassportNumber,
            GuestNationality = guest.Nationality,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Adults = reservation.AdultCount,
            Children = reservation.ChildCount,
            RoomCount = pricePreview.RoomCount,
            GuestType = request.GuestType,
            CalculatedPrice = reservation.TotalPrice,
            ManualAdjustment = reservation.ManualAdjustment,
            TotalPrice = reservation.TotalPrice,
            PaidAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? reservation.FinalAmount
                : 0,
            BaseAmount = reservation.BaseAmount,
            DiscountAmount = reservation.DiscountAmount,
            ExtraGuestAmount = reservation.ExtraGuestAmount,
            ServiceFeeAmount = reservation.ServiceFeeAmount,
            ChildAmount = pricePreview.ChildAmount,
            TaxAmount = pricePreview.TaxAmount,
            FinalAmount = reservation.FinalAmount,
            RemainingAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? 0
                : reservation.FinalAmount,
            PayableAmount = reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval || reservation.Status == ReservationStatus.PendingApproval
                ? 0
                : reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = ReservationStatusNormalizer.Normalize(reservation.Status),
            Source = reservation.Source,
            Notes = reservation.GuestNote,
            HoldUntilUtc = reservation.HoldUntilUtc,
            CreatedByUserId = reservation.CreatedByUserId ?? reservation.ClientId,
            CreatedBy = FormatUserName(reservation.Client),
            ApprovedAtUtc = reservation.ApprovedAtUtc,
            ApprovedByUserId = reservation.ApprovedByUserId,
            ApprovedBy = FormatUserName(reservation.ApprovedByUser),
            PaidAtUtc = reservation.PaidAtUtc,
            ConfirmedAtUtc = reservation.ConfirmedAtUtc,
            CancelledAtUtc = reservation.CancelledAtUtc,
            CancelledByUserId = reservation.CancelledByUserId,
            CancellationReason = reservation.CancellationReason,
            CancellationNote = reservation.CancellationNote,
            ExpiredAtUtc = reservation.ExpiredAtUtc,
            ChangedAtUtc = reservation.ChangedAtUtc,
            ChangedByUserId = reservation.ChangedByUserId,
            CreatedAtUtc = reservation.CreatedAtUtc,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
            IsPaymentExpired = IsPaymentExpired(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                DateTime.UtcNow),
            RemainingPaymentSeconds = GetRemainingPaymentSeconds(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                DateTime.UtcNow),
            AllowedStatusTransitions = GetAllowedStatusTransitions(reservation)
        };
    }

    private static bool IsPaymentExpired(
        ReservationStatus status,
        DateTime? paymentExpiresAtUtc,
        DateTime now)
    {
        return status == ReservationStatus.ApprovedAwaitingPayment &&
               paymentExpiresAtUtc.HasValue &&
               paymentExpiresAtUtc.Value <= now;
    }

    private static bool IsPaymentEligible(
        ReservationStatus status,
        DateTime? paymentExpiresAtUtc,
        decimal remainingAmount,
        DateTime now)
    {
        return ReservationStatusNormalizer.Normalize(status) == ReservationStatus.ApprovedAwaitingPayment &&
               paymentExpiresAtUtc.HasValue &&
               paymentExpiresAtUtc.Value > now &&
               remainingAmount > 0;
    }

    private async Task ApplyGuestPaymentSummaryAsync(
        ReservationResponse response,
        Reservation reservation,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var paidAmount = await dbContext.Payments.AsNoTracking()
            .Where(payment =>
                payment.ReservationId == reservation.Id &&
                payment.Status == PaymentStatus.Successful)
            .Select(payment => (decimal?)payment.Amount)
            .SumAsync(cancellationToken) ?? 0;
        var remainingAmount = Math.Max(0, reservation.FinalAmount - paidAmount);

        response.PaidAmount = paidAmount;
        response.RemainingAmount = remainingAmount;
        response.IsPaymentEligible = IsPaymentEligible(
            reservation.Status,
            reservation.PaymentExpiresAtUtc,
            remainingAmount,
            now);
    }

    private static int? GetRemainingPaymentSeconds(
        ReservationStatus status,
        DateTime? paymentExpiresAtUtc,
        DateTime now)
    {
        if (status != ReservationStatus.ApprovedAwaitingPayment ||
            !paymentExpiresAtUtc.HasValue)
        {
            return null;
        }

        var remainingSeconds = (int)Math.Ceiling((paymentExpiresAtUtc.Value - now).TotalSeconds);
        return Math.Max(0, remainingSeconds);
    }

    private IReadOnlyList<ReservationStatus> GetAllowedStatusTransitions(Reservation reservation)
    {
        var now = DateTime.UtcNow;
        return statusWorkflow.GetAllowedTransitions(reservation.Status)
            .Where(status =>
                status != ReservationStatus.PaymentExpired ||
                reservation.PaymentExpiresAtUtc.HasValue &&
                reservation.PaymentExpiresAtUtc.Value <= now)
            .ToList();
    }

    private static string CreateRawToken()
    {
        Span<byte> bytes = stackalloc byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes)
            .Replace("+", "-", StringComparison.Ordinal)
            .Replace("/", "_", StringComparison.Ordinal)
            .TrimEnd('=');
    }

    private static string HashToken(string rawToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim()));
        return Convert.ToHexString(bytes);
    }

    private static bool TryGetStatusNotification(
        ReservationStatus status,
        out NotificationEventType eventType,
        out string message)
    {
        switch (status)
        {
            case ReservationStatus.ApprovedAwaitingPayment:
                eventType = NotificationEventType.ReservationApprovedAwaitingPayment;
                message = "Reservation {0} was approved and is awaiting payment.";
                return true;
            case ReservationStatus.Confirmed:
                eventType = NotificationEventType.ReservationConfirmed;
                message = "Reservation {0} was confirmed.";
                return true;
            case ReservationStatus.Cancelled:
                eventType = NotificationEventType.ReservationCancelled;
                message = "Reservation {0} was cancelled.";
                return true;
            case ReservationStatus.PaymentExpired:
                eventType = NotificationEventType.ReservationPaymentExpired;
                message = "Payment window expired for reservation {0}.";
                return true;
            default:
                eventType = default;
                message = string.Empty;
                return false;
        }
    }

    private static string? FormatUserName(User? user)
    {
        if (user is null)
        {
            return null;
        }

        var fullName = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(fullName) ? user.Email : fullName;
    }

    private static NotificationRequest CreateReservationNotificationRequest(
        Reservation reservation,
        NotificationEventType eventType,
        string message) =>
        new()
        {
            EventType = eventType,
            RecipientUserId = reservation.ClientId,
            RecipientGuestId = reservation.GuestId,
            Mobile = reservation.Guest?.Mobile,
            Email = reservation.Guest?.Email,
            Subject = reservation.ReservationNumber,
            Message = message,
            DataJson = JsonSerializer.Serialize(new
            {
                reservationId = reservation.Id,
                reservationNumber = reservation.ReservationNumber,
                reservation.PropertyId,
                reservation.RoomTypeId,
                reservation.GuestId,
                reservation.CheckInDate,
                reservation.CheckOutDate,
                reservation.PaymentExpiresAtUtc
            }),
            Channels = NotificationChannel.InApp
        };

    private ReservationResponse ToResponse(
        Reservation reservation,
        Property property,
        RoomType roomType,
        Guest? guest)
    {
        return new ReservationResponse
        {
            ReservationId = reservation.Id,
            Id = reservation.Id,
            ReservationNumber = reservation.ReservationNumber ?? string.Empty,
            PropertyId = reservation.PropertyId,
            PropertyName = property.Name,
            RoomTypeId = reservation.RoomTypeId,
            RoomTypeName = roomType.Name,
            RoomId = reservation.RoomId,
            RoomName = reservation.Room?.Name,
            GuestId = reservation.GuestId,
            GuestFullName = guest?.FullName ?? string.Empty,
            GuestMobile = guest?.Mobile,
            GuestEmail = guest?.Email,
            GuestNationalCode = guest?.NationalCode,
            GuestPassportNumber = guest?.PassportNumber,
            GuestNationality = guest?.Nationality,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Adults = reservation.AdultCount,
            Children = reservation.ChildCount,
            RoomCount = 1,
            CalculatedPrice = reservation.TotalPrice,
            ManualAdjustment = reservation.ManualAdjustment,
            TotalPrice = reservation.TotalPrice,
            PaidAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? reservation.FinalAmount
                : 0,
            BaseAmount = reservation.BaseAmount,
            DiscountAmount = reservation.DiscountAmount,
            ExtraGuestAmount = reservation.ExtraGuestAmount,
            ServiceFeeAmount = reservation.ServiceFeeAmount,
            FinalAmount = reservation.FinalAmount,
            RemainingAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? 0
                : reservation.FinalAmount,
            PayableAmount = reservation.Status == ReservationStatusNormalizer.LegacyPendingApproval || reservation.Status == ReservationStatus.PendingApproval
                ? 0
                : reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = ReservationStatusNormalizer.Normalize(reservation.Status),
            Source = reservation.Source,
            Notes = reservation.GuestNote,
            HoldUntilUtc = reservation.HoldUntilUtc,
            CreatedByUserId = reservation.CreatedByUserId ?? reservation.ClientId,
            CreatedBy = FormatUserName(reservation.Client),
            ApprovedAtUtc = reservation.ApprovedAtUtc,
            ApprovedByUserId = reservation.ApprovedByUserId,
            ApprovedBy = FormatUserName(reservation.ApprovedByUser),
            PaidAtUtc = reservation.PaidAtUtc,
            ConfirmedAtUtc = reservation.ConfirmedAtUtc,
            CancelledAtUtc = reservation.CancelledAtUtc,
            CancelledByUserId = reservation.CancelledByUserId,
            CancellationReason = reservation.CancellationReason,
            CancellationNote = reservation.CancellationNote,
            ExpiredAtUtc = reservation.ExpiredAtUtc,
            ChangedAtUtc = reservation.ChangedAtUtc,
            ChangedByUserId = reservation.ChangedByUserId,
            CreatedAtUtc = reservation.CreatedAtUtc,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
            IsPaymentExpired = IsPaymentExpired(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                DateTime.UtcNow),
            IsPaymentEligible = IsPaymentEligible(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                    ? 0
                    : reservation.FinalAmount,
                DateTime.UtcNow),
            RemainingPaymentSeconds = GetRemainingPaymentSeconds(
                reservation.Status,
                reservation.PaymentExpiresAtUtc,
                DateTime.UtcNow),
            AllowedStatusTransitions = GetAllowedStatusTransitions(reservation)
        };
    }

    private sealed class ReservationListProjection
    {
        public int Id { get; set; }
        public string? ReservationNumber { get; set; }
        public int PropertyId { get; set; }
        public string PropertyName { get; set; } = string.Empty;
        public int RoomTypeId { get; set; }
        public string RoomTypeName { get; set; } = string.Empty;
        public int? RoomId { get; set; }
        public string? RoomName { get; set; }
        public int? GuestId { get; set; }
        public string? GuestFirstName { get; set; }
        public string? GuestLastName { get; set; }
        public string? GuestMobile { get; set; }
        public DateOnly CheckInDate { get; set; }
        public DateOnly CheckOutDate { get; set; }
        public int Adults { get; set; }
        public int Children { get; set; }
        public decimal ManualAdjustment { get; set; }
        public decimal TotalPrice { get; set; }
        public decimal FinalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public string Currency { get; set; } = "IRR";
        public ReservationStatus Status { get; set; }
        public ReservationSource Source { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime? PaidAtUtc { get; set; }
        public DateTime? PaymentExpiresAtUtc { get; set; }
    }

    private sealed record ManualAdjustmentAuditEntry(decimal OldValue, decimal NewValue);
}
