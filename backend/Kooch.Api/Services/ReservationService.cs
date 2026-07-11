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
    IReservationStatusWorkflow statusWorkflow,
    IHostEnvironment hostEnvironment) : IReservationService
{
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

        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
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

        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
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

        var response = ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
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
        ValidateDateRange(request.CheckInDate, request.CheckOutDate);

        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == request.PropertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");

        var roomType = await dbContext.RoomTypes.AsNoTracking()
            .SingleOrDefaultAsync(item =>
                    item.Id == request.RoomTypeId &&
                    item.PropertyId == request.PropertyId &&
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
            request.PropertyId,
            request.RoomTypeId,
            request.CheckInDate,
            request.CheckOutDate,
            roomCount,
            cancellationToken);
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
        var reservation = new Reservation
        {
            ReservationNumber = reservationNumber,
            ClientId = currentUser.UserId,
            GuestId = request.GuestId,
            PropertyId = request.PropertyId,
            RoomTypeId = request.RoomTypeId,
            RoomId = selectedRoomIds.Count > 0 ? selectedRoomIds[0] : null,
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
            Status = ResolveCreateStatus(request.Status, isOnRequest, currentUser.Role),
            Source = GetReservationSource(currentUser.Role),
            GuestNote = request.Notes
        };

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

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

        if (IsLockedForFullEdit(reservation.Status))
        {
            EnsureLockedReservationOnlyNotes(reservation, request);
            reservation.GuestNote = request.Notes;
            reservation.UpdatedAtUtc = DateTime.UtcNow;
            reservation.UpdatedByUserId = currentUser.UserId;
            await dbContext.SaveChangesAsync(cancellationToken);
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
            cancellationToken);
        ValidateAvailabilityForCreate(availability, roomCount);

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
        reservation.FinalAmount = pricePreview.FinalAmount;
        reservation.Currency = pricePreview.Currency;
        reservation.GuestNote = request.Notes;
        reservation.ChangedAtUtc = DateTime.UtcNow;
        reservation.ChangedByUserId = currentUser.UserId;
        reservation.UpdatedAtUtc = reservation.ChangedAtUtc;
        reservation.UpdatedByUserId = currentUser.UserId;

        await dbContext.SaveChangesAsync(cancellationToken);

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
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        return await UpdateStatusAsync(
            reservationId,
            new ReservationStatusUpdateRequest
            {
                Status = ReservationStatus.Cancelled
            },
            currentUser,
            cancellationToken);
    }

    public async Task<bool> ExpirePaymentWindowAsync(
        int reservationId,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (reservation.Status != ReservationStatus.ApprovedAwaitingPayment ||
            reservation.PaymentExpiresAtUtc is null ||
            reservation.PaymentExpiresAtUtc > DateTime.UtcNow)
        {
            return false;
        }

        reservation.Status = ReservationStatus.PaymentExpired;
        reservation.ExpiredAtUtc = DateTime.UtcNow;
        reservation.ChangedAtUtc = reservation.ExpiredAtUtc;

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

    public async Task<ReservationResponse> UpdateStatusAsync(
        int reservationId,
        ReservationStatusUpdateRequest request,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        statusWorkflow.ValidateTransition(reservation.Status, request.Status);

        var now = DateTime.UtcNow;
        if (request.Status == ReservationStatus.PaymentExpired &&
            (reservation.PaymentExpiresAtUtc is null || reservation.PaymentExpiresAtUtc > now))
        {
            throw new InvalidOperationException("Payment deadline has not expired yet.");
        }

        reservation.Status = request.Status;
        reservation.ChangedAtUtc = now;
        reservation.ChangedByUserId = currentUser.UserId;

        switch (request.Status)
        {
            case ReservationStatus.Confirmed:
                reservation.ConfirmedAtUtc ??= now;
                break;
            case ReservationStatus.Paid:
                reservation.PaidAtUtc ??= now;
                reservation.ConfirmedAtUtc ??= now;
                break;
            case ReservationStatus.Cancelled:
                reservation.CancelledAtUtc ??= now;
                reservation.CancelledByUserId ??= currentUser.UserId;
                break;
            case ReservationStatus.Expired:
            case ReservationStatus.PaymentExpired:
                reservation.ExpiredAtUtc ??= now;
                break;
            case ReservationStatus.ApprovedAwaitingPayment:
                reservation.ApprovedAtUtc ??= now;
                reservation.ApprovedByUserId ??= currentUser.UserId;
                reservation.PaymentExpiresAtUtc ??= now.AddMinutes(10);
                break;
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        if (TryGetStatusNotification(request.Status, out var eventType, out var message))
        {
            await notificationService.SendAsync(
                CreateReservationNotificationRequest(
                    reservation,
                    eventType,
                    string.Format(message, reservation.ReservationNumber)),
                cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
    }

    public async Task<ReservationPaymentLinkResponse> GeneratePaymentLinkAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
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

    private static void EnsureAdminUser(UserRole role)
    {
        if (role is not (UserRole.SuperAdmin or UserRole.AdminAssistant))
        {
            throw new UnauthorizedAccessException("Only admin users can edit reservations.");
        }
    }

    private static bool IsLockedForFullEdit(ReservationStatus status) =>
        status is ReservationStatus.Confirmed or ReservationStatus.Paid or ReservationStatus.Completed;

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

    private static ReservationStatus ResolveCreateStatus(
        ReservationStatus? requestedStatus,
        bool isOnRequest,
        UserRole role)
    {
        var defaultStatus = isOnRequest ? ReservationStatus.PendingApproval : ReservationStatus.Pending;
        if (requestedStatus is null || role is not (UserRole.SuperAdmin or UserRole.AdminAssistant))
        {
            return defaultStatus;
        }

        return requestedStatus.Value;
    }

    private IQueryable<Reservation> ReservationQuery() =>
        dbContext.Reservations
            .AsNoTracking()
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Room)
            .Include(item => item.Guest)
            .Include(item => item.Client)
            .Include(item => item.ApprovedByUser);

    private async Task<PagedResult<ReservationListItemResponse>> SearchInternalAsync(
        ReservationListQuery query,
        int? scopedPropertyId,
        int? scopedGuestId,
        CancellationToken cancellationToken)
    {
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
            query = query.Where(reservation => reservation.Status == filters.Status.Value);
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
                    reservation.Status == ReservationStatus.OnHold ||
                    reservation.Status == ReservationStatus.ApprovedAwaitingPayment ||
                    reservation.Status == ReservationStatus.PaymentExpired)
                : query.Where(reservation =>
                    reservation.Status != ReservationStatus.PendingApproval &&
                    reservation.Status != ReservationStatus.OnHold &&
                    reservation.Status != ReservationStatus.ApprovedAwaitingPayment &&
                    reservation.Status != ReservationStatus.PaymentExpired);
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
            FinalAmount = reservation.FinalAmount,
            TotalPrice = reservation.TotalPrice,
            PaidAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? reservation.FinalAmount
                : 0,
            RemainingAmount = reservation.PaidAtUtc.HasValue || reservation.Status == ReservationStatus.Paid
                ? 0
                : reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = reservation.Status,
            Source = reservation.Source,
            CreatedAtUtc = reservation.CreatedAtUtc,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc,
            IsPaymentExpired = IsPaymentExpired(reservation.Status, reservation.PaymentExpiresAtUtc, DateTime.UtcNow),
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
            TotalPrice = row.TotalPrice,
            FinalAmount = row.FinalAmount,
            PaidAmount = row.PaidAmount,
            RemainingAmount = Math.Max(0, row.FinalAmount - row.PaidAmount),
            Currency = row.Currency,
            Status = row.Status,
            Source = row.Source,
            CreatedAtUtc = row.CreatedAtUtc,
            PaymentExpiresAtUtc = row.PaymentExpiresAtUtc,
            IsPaymentExpired = IsPaymentExpired(row.Status, row.PaymentExpiresAtUtc, now),
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
            PayableAmount = reservation.Status is ReservationStatus.OnHold or ReservationStatus.PendingApproval
                ? 0
                : reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = reservation.Status,
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
            PayableAmount = reservation.Status is ReservationStatus.OnHold or ReservationStatus.PendingApproval
                ? 0
                : reservation.FinalAmount,
            Currency = reservation.Currency,
            Status = reservation.Status,
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
}
