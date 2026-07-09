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
    INotificationService notificationService) : IReservationService
{
    public async Task<PagedResult<ReservationListItemResponse>> SearchAsync(
        ReservationListQuery query,
        CancellationToken cancellationToken = default)
    {
        return await SearchInternalAsync(query, null, cancellationToken);
    }

    public async Task<PagedResult<ReservationListItemResponse>> SearchByPropertyAsync(
        int propertyId,
        ReservationListQuery query,
        CancellationToken cancellationToken = default)
    {
        return await SearchInternalAsync(query, propertyId, cancellationToken);
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

        return ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
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
                Infants = request.Infants,
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
            AdultCount = request.Adults,
            ChildCount = request.Children,
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

    public async Task<ReservationResponse> ApproveAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (reservation.Status is not ReservationStatus.PendingApproval and not ReservationStatus.OnHold)
        {
            throw new InvalidOperationException("Only on-request reservations awaiting approval can be approved.");
        }

        var now = DateTime.UtcNow;
        reservation.Status = ReservationStatus.ApprovedAwaitingPayment;
        reservation.ApprovedAtUtc = now;
        reservation.ApprovedByUserId = currentUser.UserId;
        reservation.PaymentExpiresAtUtc = now.AddMinutes(10);

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await notificationService.SendAsync(
            CreateReservationNotificationRequest(
                reservation,
                NotificationEventType.ReservationApprovedAwaitingPayment,
                $"Reservation {reservation.ReservationNumber} was approved and is awaiting payment."),
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ToResponse(reservation, reservation.Property, reservation.RoomType, reservation.Guest);
    }

    public async Task<ReservationResponse> CancelAsync(
        int reservationId,
        (int UserId, UserRole Role) currentUser,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
            .SingleOrDefaultAsync(item => item.Id == reservationId, cancellationToken)
            ?? throw new KeyNotFoundException("Reservation not found.");

        if (reservation.Status is not ReservationStatus.PendingApproval and not ReservationStatus.OnHold)
        {
            throw new InvalidOperationException("Only on-request reservations awaiting review can be cancelled from this action.");
        }

        reservation.Status = ReservationStatus.Cancelled;
        reservation.CancelledAtUtc = DateTime.UtcNow;
        reservation.CancelledByUserId = currentUser.UserId;

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

    public async Task<bool> ExpirePaymentWindowAsync(
        int reservationId,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations
            .Include(item => item.Property)
            .Include(item => item.RoomType)
            .Include(item => item.Guest)
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
            .Include(item => item.Guest);

    private async Task<PagedResult<ReservationListItemResponse>> SearchInternalAsync(
        ReservationListQuery query,
        int? scopedPropertyId,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);
        var reservations = ApplyFilters(dbContext.Reservations.AsNoTracking(), query, scopedPropertyId);
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

        return new PagedResult<ReservationListItemResponse>
        {
            Items = rows.Select(ToListItemResponse).ToList(),
            TotalCount = totalCount,
            Page = page,
            PageSize = pageSize,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    private static IQueryable<Reservation> ApplyFilters(
        IQueryable<Reservation> query,
        ReservationListQuery filters,
        int? scopedPropertyId)
    {
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
            GuestId = reservation.GuestId,
            GuestFullName = reservation.Guest?.FullName ?? string.Empty,
            GuestMobile = reservation.Guest?.Mobile,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Adults = reservation.AdultCount,
            Children = reservation.ChildCount,
            Infants = 0,
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
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc
        };

    private static ReservationListItemResponse ToListItemResponse(ReservationListProjection row)
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
            GuestId = row.GuestId,
            GuestFullName = guestName,
            GuestMobile = row.GuestMobile,
            CheckInDate = row.CheckInDate,
            CheckOutDate = row.CheckOutDate,
            NightsCount = row.CheckOutDate.DayNumber - row.CheckInDate.DayNumber,
            Adults = row.Adults,
            Children = row.Children,
            Infants = 0,
            RoomCount = 1,
            TotalPrice = row.TotalPrice,
            FinalAmount = row.FinalAmount,
            PaidAmount = row.PaidAmount,
            RemainingAmount = Math.Max(0, row.FinalAmount - row.PaidAmount),
            Currency = row.Currency,
            Status = row.Status,
            Source = row.Source,
            CreatedAtUtc = row.CreatedAtUtc,
            PaymentExpiresAtUtc = row.PaymentExpiresAtUtc
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

    private static ReservationResponse ToResponse(
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
            GuestId = reservation.GuestId,
            GuestFullName = guest.FullName,
            GuestMobile = guest.Mobile,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Adults = reservation.AdultCount,
            Children = reservation.ChildCount,
            Infants = request.Infants,
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
            PaidAtUtc = reservation.PaidAtUtc,
            ConfirmedAtUtc = reservation.ConfirmedAtUtc,
            CancelledAtUtc = reservation.CancelledAtUtc,
            ExpiredAtUtc = reservation.ExpiredAtUtc,
            CreatedAtUtc = reservation.CreatedAtUtc,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc
        };
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

    private static ReservationResponse ToResponse(
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
            GuestId = reservation.GuestId,
            GuestFullName = guest?.FullName ?? string.Empty,
            GuestMobile = guest?.Mobile,
            CheckInDate = reservation.CheckInDate,
            CheckOutDate = reservation.CheckOutDate,
            NightsCount = reservation.CheckOutDate.DayNumber - reservation.CheckInDate.DayNumber,
            Adults = reservation.AdultCount,
            Children = reservation.ChildCount,
            Infants = 0,
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
            PaidAtUtc = reservation.PaidAtUtc,
            ConfirmedAtUtc = reservation.ConfirmedAtUtc,
            CancelledAtUtc = reservation.CancelledAtUtc,
            ExpiredAtUtc = reservation.ExpiredAtUtc,
            CreatedAtUtc = reservation.CreatedAtUtc,
            PaymentExpiresAtUtc = reservation.PaymentExpiresAtUtc
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
