using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class BookingSessionService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService,
    IReservationPricingService pricingService,
    IReservationStatusWorkflow statusWorkflow,
    IReservationNumberGenerator reservationNumberGenerator,
    IBookingSessionCodeGenerator sessionCodeGenerator,
    IReservationNotificationDispatcher notificationDispatcher) : IBookingSessionService
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> LocalResourceLocks = new();

    public Task<BookingSessionCreateResult> CreateAsync(
        BookingSessionCreateRequest request,
        CancellationToken cancellationToken = default) =>
        CreateCoreAsync(request, BookingSessionCreationKind.Internal, null, cancellationToken);

    public async Task<BookingSessionCreateResult> CreateForAccountAsync(
        int clientId,
        AccountBookingSessionCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var accountContext = NormalizeAccountContext(request);
        if (request.Items is null)
        {
            throw new ArgumentException(nameof(request.Items));
        }

        var roomTypeIds = request.Items
            .Select(item => item.RoomTypeId)
            .Distinct()
            .ToArray();
        if (roomTypeIds.Length is 0)
        {
            throw new ArgumentException("A booking session must contain at least one reservation item.");
        }

        var identity = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == clientId && user.IsActive)
            .Select(user => new { GuestId = user.Guest == null ? null : (int?)user.Guest.Id })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException("Client not found.");
        var roomTypeProperties = await dbContext.RoomTypes.AsNoTracking()
            .Where(roomType => roomTypeIds.Contains(roomType.Id) && roomType.IsActive)
            .Select(roomType => new { roomType.Id, roomType.PropertyId })
            .ToListAsync(cancellationToken);
        if (roomTypeProperties.Count != roomTypeIds.Length)
        {
            throw new KeyNotFoundException("Room type not found.");
        }

        var propertyIds = roomTypeProperties.Select(item => item.PropertyId).Distinct().ToArray();
        if (propertyIds.Length is not 1)
        {
            throw new InvalidOperationException("All reservations in a booking session must belong to one property.");
        }

        var internalRequest = new BookingSessionCreateRequest
        {
            ClientId = clientId,
            GuestId = accountContext.BookingForSelf ? identity.GuestId : null,
            PropertyId = propertyIds[0],
            IdempotencyKey = request.IdempotencyKey,
            Items = request.Items
                .Select(item => ToInternalItem(item, accountContext.SpecialRequest))
                .ToArray()
        };
        return await CreateCoreAsync(
            internalRequest,
            BookingSessionCreationKind.Account,
            accountContext,
            cancellationToken);
    }

    private async Task<BookingSessionCreateResult> CreateCoreAsync(
        BookingSessionCreateRequest request,
        BookingSessionCreationKind creationKind,
        AccountBookingContext? accountContext,
        CancellationToken cancellationToken)
    {
        ValidateRequest(request);
        var normalizedIdempotencyKey = NormalizeIdempotencyKey(request.IdempotencyKey);
        var requestHash = creationKind == BookingSessionCreationKind.Account
            ? ComputeAccountRequestHash(
                request,
                accountContext ?? throw new InvalidOperationException("Account booking context is required."))
            : ComputeRequestHash(request);
        var lockOrder = BuildLockOrder(request.Items);
        var localResources = BuildLocalResourceNames(
            request.ClientId,
            normalizedIdempotencyKey,
            lockOrder);

        await using var localLockScope = await AcquireLocalResourceLocksAsync(
            localResources,
            cancellationToken);
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        if (normalizedIdempotencyKey is not null)
        {
            await AcquireIdempotencyDatabaseLockAsync(
                request.ClientId,
                normalizedIdempotencyKey,
                cancellationToken);
            var existingSession = await FindExistingSessionAsync(
                request.ClientId,
                normalizedIdempotencyKey,
                cancellationToken);
            if (existingSession is not null)
            {
                if (!string.Equals(existingSession.RequestHash, requestHash, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "The idempotency key has already been used with a different booking payload.");
                }

                await transaction.CommitAsync(cancellationToken);
                return ToResult(existingSession);
            }
        }

        await ValidateClientAndGuestAsync(request, cancellationToken);
        await ValidatePropertyAsync(
            request.PropertyId,
            creationKind,
            cancellationToken);
        var roomTypes = await LockRoomTypesAsync(lockOrder.RoomTypeIds, cancellationToken);
        var rooms = await LockRoomsAsync(lockOrder.RoomIds, cancellationToken);
        ValidateRoomRelationships(request, roomTypes, rooms);

        var preparedItems = await PrepareItemsAsync(
            request,
            creationKind,
            cancellationToken);
        ValidateAccountBookingMode(preparedItems, creationKind);
        var currency = AssertSameCurrency(preparedItems);
        var primaryGuest = await ResolvePrimaryGuestAsync(
            request.ClientId,
            request.GuestId,
            accountContext,
            cancellationToken);
        var reservationNumbers = await reservationNumberGenerator.GenerateBatchAsync(
            preparedItems.Count,
            DateTime.UtcNow,
            cancellationToken);
        var now = DateTime.UtcNow;
        var commonPaymentDeadlineUtc =
            creationKind == BookingSessionCreationKind.Account &&
            preparedItems.All(item => !item.IsOnRequest)
                ? now.AddMinutes(await ReservationPaymentWindowSettings.GetMinutesAsync(
                    dbContext,
                    cancellationToken))
                : (DateTime?)null;
        var commonApprovalDeadlineUtc = preparedItems.Any(item =>
                item.Status == ReservationStatus.PendingApproval)
            ? now.AddMinutes(await ReservationOwnerApprovalWindowSettings.GetMinutesAsync(
                dbContext,
                cancellationToken))
            : (DateTime?)null;
        var session = new BookingSession
        {
            SessionCode = sessionCodeGenerator.Generate(),
            ClientId = request.ClientId,
            GuestId = primaryGuest.GuestId,
            Guest = primaryGuest.NewGuest,
            PropertyId = request.PropertyId,
            Currency = currency,
            ExpectedArrivalTime = accountContext?.ExpectedArrivalTime,
            IdempotencyKey = normalizedIdempotencyKey,
            RequestHash = requestHash
        };

        for (var index = 0; index < preparedItems.Count; index++)
        {
            var prepared = preparedItems[index];
            session.Reservations.Add(new Reservation
            {
                ReservationNumber = reservationNumbers[index],
                ClientId = request.ClientId,
                GuestId = primaryGuest.GuestId,
                Guest = primaryGuest.NewGuest,
                PropertyId = request.PropertyId,
                RoomTypeId = prepared.Item.RoomTypeId,
                RoomId = prepared.Item.RoomId,
                CheckInDate = prepared.Item.CheckInDate,
                CheckOutDate = prepared.Item.CheckOutDate,
                AdultCount = prepared.Price.Adults,
                ChildCount = prepared.Price.Children,
                TotalPrice = prepared.Price.FinalAmount,
                BaseAmount = prepared.Price.BaseAmount,
                DiscountAmount = prepared.Price.DiscountAmount,
                ExtraGuestAmount = prepared.Price.ExtraGuestAmount,
                ServiceFeeAmount = prepared.Price.ServiceFeeAmount,
                FinalAmount = prepared.Price.FinalAmount,
                Currency = prepared.Currency,
                Status = prepared.Status,
                ApprovedAtUtc = commonPaymentDeadlineUtc.HasValue ? now : null,
                ApprovalExpiresAtUtc = prepared.Status == ReservationStatus.PendingApproval
                    ? commonApprovalDeadlineUtc
                    : null,
                PaymentExpiresAtUtc = commonPaymentDeadlineUtc,
                ConfirmedAtUtc = prepared.Status == ReservationStatus.Confirmed ? now : null,
                Source = ReservationSource.Website,
                GuestNote = NormalizeOptionalText(prepared.Item.Notes)
            });
        }

        dbContext.BookingSessions.Add(session);
        await dbContext.SaveChangesAsync(cancellationToken);
        var pendingApprovalIds = session.Reservations
            .Where(reservation => reservation.Status == ReservationStatus.PendingApproval)
            .Select(reservation => reservation.Id)
            .ToArray();
        if (pendingApprovalIds.Length > 0)
        {
            await notificationDispatcher.NotifyPendingApprovalAsync(
                pendingApprovalIds,
                cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return ToResult(session);
    }

    internal static string? NormalizeIdempotencyKey(string? idempotencyKey)
    {
        var normalized = idempotencyKey?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

    private static BookingSessionReservationCreateItem ToInternalItem(
        AccountBookingSessionReservationCreateItem item,
        string? specialRequest) =>
        new()
        {
            RoomTypeId = item.RoomTypeId,
            RoomId = item.RoomId,
            CheckInDate = item.CheckInDate,
            CheckOutDate = item.CheckOutDate,
            Adults = item.Adults,
            Children = item.Children,
            ChildAges = item.ChildAges,
            GuestType = PricingGuestType.Iranian,
            Status = null,
            Notes = specialRequest ?? item.Notes
        };

    internal static string ComputeRequestHash(BookingSessionCreateRequest request)
    {
        var canonicalItems = request.Items
            .Select(item => new CanonicalBookingItem(
                item.RoomTypeId,
                item.RoomId,
                item.CheckInDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                item.CheckOutDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                item.Adults,
                item.Children,
                item.ChildAges.Order().ToArray(),
                (int)item.GuestType,
                item.Status.HasValue ? (int)item.Status.Value : null,
                NormalizeOptionalText(item.Notes)))
            .OrderBy(item => item.RoomTypeId)
            .ThenBy(item => item.RoomId)
            .ThenBy(item => item.CheckInDate, StringComparer.Ordinal)
            .ThenBy(item => item.CheckOutDate, StringComparer.Ordinal)
            .ThenBy(item => item.Adults)
            .ThenBy(item => item.Children)
            .ThenBy(item => string.Join(",", item.ChildAges), StringComparer.Ordinal)
            .ThenBy(item => item.GuestType)
            .ThenBy(item => item.Status)
            .ThenBy(item => item.Notes, StringComparer.Ordinal)
            .ToArray();
        var canonicalRequest = new CanonicalBookingRequest(
            request.ClientId,
            request.GuestId,
            request.PropertyId,
            canonicalItems);
        var payload = JsonSerializer.SerializeToUtf8Bytes(canonicalRequest);
        return Convert.ToHexString(SHA256.HashData(payload));
    }

    private static string ComputeAccountRequestHash(
        BookingSessionCreateRequest request,
        AccountBookingContext accountContext)
    {
        var canonicalHash = ComputeRequestHash(request);
        if (accountContext.BookingForSelf &&
            accountContext.PrimaryGuest is null &&
            accountContext.ExpectedArrivalTime is null &&
            accountContext.SpecialRequest is null)
        {
            var legacyPayload = Encoding.UTF8.GetBytes(
                nameof(BookingSessionCreationKind.Account) + canonicalHash);
            return Convert.ToHexString(SHA256.HashData(legacyPayload));
        }

        var expectedArrivalTime = accountContext.ExpectedArrivalTime?.ToString(
            "HH:mm:ss.fffffff",
            CultureInfo.InvariantCulture);
        object canonicalRequest = accountContext.PrimaryGuest?.NationalCode is null
            ? new CanonicalAccountBookingRequest(
                canonicalHash,
                accountContext.BookingForSelf,
                expectedArrivalTime,
                accountContext.SpecialRequest,
                accountContext.PrimaryGuest is null
                    ? null
                    : new CanonicalPrimaryGuest(
                        accountContext.PrimaryGuest.FirstName,
                        accountContext.PrimaryGuest.LastName,
                        accountContext.PrimaryGuest.Mobile,
                        accountContext.PrimaryGuest.Email))
            : new CanonicalAccountBookingRequestWithNationalCode(
                canonicalHash,
                accountContext.BookingForSelf,
                expectedArrivalTime,
                accountContext.SpecialRequest,
                new CanonicalPrimaryGuestWithNationalCode(
                    accountContext.PrimaryGuest.FirstName,
                    accountContext.PrimaryGuest.LastName,
                    accountContext.PrimaryGuest.Mobile,
                    accountContext.PrimaryGuest.Email,
                    accountContext.PrimaryGuest.NationalCode));
        var scopedPayload = JsonSerializer.SerializeToUtf8Bytes(canonicalRequest);
        return Convert.ToHexString(SHA256.HashData(scopedPayload));
    }

    internal static BookingSessionLockOrder BuildLockOrder(
        IReadOnlyCollection<BookingSessionReservationCreateItem> items) =>
        new(
            items.Select(item => item.RoomTypeId).Distinct().Order().ToArray(),
            items.Where(item => item.RoomId.HasValue)
                .Select(item => item.RoomId!.Value)
                .Distinct()
                .Order()
                .ToArray());

    private static AccountBookingContext NormalizeAccountContext(
        AccountBookingSessionCreateRequest request)
    {
        var validationResults = new List<ValidationResult>();
        Validator.TryValidateObject(
            request,
            new ValidationContext(request),
            validationResults,
            validateAllProperties: true);
        if (request.PrimaryGuest is not null)
        {
            Validator.TryValidateObject(
                request.PrimaryGuest,
                new ValidationContext(request.PrimaryGuest),
                validationResults,
                validateAllProperties: true);
        }

        if (validationResults.Count > 0)
        {
            throw new ArgumentException(
                validationResults[0].ErrorMessage ?? "Invalid account booking details.",
                nameof(request));
        }

        var specialRequest = NormalizeOptionalText(request.SpecialRequest);
        if (specialRequest?.Length > 2000)
        {
            throw new ArgumentException(
                "Special request cannot exceed 2000 characters.",
                nameof(request));
        }

        NormalizedPrimaryGuest? primaryGuest = null;
        if (request.BookingForSelf)
        {
            if (request.PrimaryGuest is { } input)
            {
                var normalized = NormalizePrimaryGuest(input);
                if (normalized.HasAnyValue)
                {
                    primaryGuest = normalized.Guest;
                }
            }
        }
        else
        {
            var input = request.PrimaryGuest
                ?? throw new ArgumentException("Primary guest is required.", nameof(request));
            primaryGuest = new NormalizedPrimaryGuest(
                GuestNormalization.NormalizeText(input.FirstName)!,
                GuestNormalization.NormalizeText(input.LastName)!,
                GuestNormalization.NormalizeMobile(input.Mobile),
                GuestNormalization.NormalizeEmail(input.Email),
                GuestNormalization.NormalizeNationalCode(input.NationalCode));
        }

        return new AccountBookingContext(
            request.BookingForSelf,
            primaryGuest,
            request.ExpectedArrivalTime,
            specialRequest);
    }

    private async Task<PrimaryGuestAssignment> ResolvePrimaryGuestAsync(
        int clientId,
        int? currentGuestId,
        AccountBookingContext? accountContext,
        CancellationToken cancellationToken)
    {
        if (accountContext is null)
        {
            return new PrimaryGuestAssignment(currentGuestId, null);
        }

        if (accountContext.BookingForSelf)
        {
            var linkedGuest = currentGuestId.HasValue
                ? dbContext.Database.IsSqlServer()
                    ? await dbContext.Guests
                        .FromSqlInterpolated(
                            $"SELECT * FROM Guests WITH (UPDLOCK, HOLDLOCK) WHERE Id = {currentGuestId.Value} AND UserId = {clientId}")
                        .SingleAsync(cancellationToken)
                    : await dbContext.Guests.SingleAsync(
                        guest => guest.Id == currentGuestId.Value && guest.UserId == clientId,
                        cancellationToken)
                : await GetOrCreateLinkedGuestAsync(clientId, cancellationToken);
            if (accountContext.PrimaryGuest is { } selfInput)
            {
                await ApplySelfGuestUpdatesAsync(selfInput, linkedGuest, clientId, cancellationToken);
            }

            return new PrimaryGuestAssignment(linkedGuest.Id, linkedGuest.Id == 0 ? linkedGuest : null);
        }

        var input = accountContext.PrimaryGuest
            ?? throw new InvalidOperationException("Primary guest details are required.");
        var matchingGuests = await dbContext.Guests
            .Where(guest =>
                (input.Mobile != null && guest.NormalizedMobile == input.Mobile) ||
                (input.Email != null && guest.NormalizedEmail == input.Email))
            .Take(2)
            .ToListAsync(cancellationToken);
        if (matchingGuests.Count > 1)
        {
            throw new ArgumentException("اطلاعات تماس مهمان با بیش از یک پرونده مطابقت دارد.");
        }

        if (matchingGuests.Count == 1)
        {
            var guest = matchingGuests[0];
            EnsureContactsDoNotConflict(input, guest.NormalizedMobile, guest.NormalizedEmail);
            ApplyNationalCodeIfProvided(input.NationalCode, guest);
            return new PrimaryGuestAssignment(guest.Id, null);
        }

        var matchingUsers = await dbContext.Users
            .IgnoreQueryFilters()
            .Where(user =>
                (input.Mobile != null && user.PhoneNumber == input.Mobile) ||
                (input.Email != null && user.Email == input.Email))
            .Take(2)
            .ToListAsync(cancellationToken);
        if (matchingUsers.Count > 1)
        {
            throw new ArgumentException("اطلاعات تماس مهمان با بیش از یک حساب مطابقت دارد.");
        }

        int? linkedUserId = null;
        if (matchingUsers.Count == 1)
        {
            var user = matchingUsers[0];
            EnsureContactsDoNotConflict(input, user.PhoneNumber, user.Email);
            if (user.Role != UserRole.Client)
            {
                throw new ArgumentException("مهمان با این اطلاعات قابل ثبت نیست.");
            }

            var alreadyLinked = await dbContext.Guests
                .AnyAsync(guest => guest.UserId == user.Id, cancellationToken);
            if (alreadyLinked)
            {
                throw new ArgumentException("مهمانی با این اطلاعات قبلاً ثبت شده است.");
            }

            linkedUserId = user.Id;
        }

        var newGuest = new Guest
        {
            UserId = linkedUserId,
            FirstName = input.FirstName!,
            LastName = input.LastName!,
            Mobile = input.Mobile,
            NormalizedMobile = input.Mobile,
            Email = input.Email,
            NormalizedEmail = input.Email,
            NationalCode = input.NationalCode,
            Nationality = "ایران"
        };
        dbContext.Guests.Add(newGuest);
        return new PrimaryGuestAssignment(null, newGuest);
    }

    private static (NormalizedPrimaryGuest Guest, bool HasAnyValue) NormalizePrimaryGuest(
        AccountBookingSessionPrimaryGuestRequest input)
    {
        var guest = new NormalizedPrimaryGuest(
            GuestNormalization.NormalizeText(input.FirstName),
            GuestNormalization.NormalizeText(input.LastName),
            GuestNormalization.NormalizeMobile(input.Mobile),
            GuestNormalization.NormalizeEmail(input.Email),
            GuestNormalization.NormalizeNationalCode(input.NationalCode));
        return (guest, guest.FirstName is not null ||
                       guest.LastName is not null ||
                       guest.Mobile is not null ||
                       guest.Email is not null ||
                       guest.NationalCode is not null);
    }

    private async Task<Guest> GetOrCreateLinkedGuestAsync(
        int clientId,
        CancellationToken cancellationToken)
    {
        var user = dbContext.Database.IsSqlServer()
            ? await dbContext.Users
                .FromSqlInterpolated(
                    $"SELECT * FROM Users WITH (UPDLOCK, HOLDLOCK) WHERE Id = {clientId}")
                .SingleAsync(cancellationToken)
            : await dbContext.Users.SingleAsync(user => user.Id == clientId, cancellationToken);
        var linkedGuest = await dbContext.Guests
            .SingleOrDefaultAsync(guest => guest.UserId == clientId, cancellationToken);
        if (linkedGuest is not null)
        {
            return linkedGuest;
        }

        var mobile = UserIdentityNormalization.NormalizePhoneNumber(user.PhoneNumber);
        var email = IsInternalUserEmail(user.Email)
            ? null
            : UserIdentityNormalization.NormalizeEmail(user.Email);
        var candidates = await dbContext.Guests
            .Where(guest =>
                (mobile != null && guest.NormalizedMobile == mobile) ||
                (email != null && guest.NormalizedEmail == email))
            .Take(2)
            .ToListAsync(cancellationToken);
        if (candidates.Count > 1 || candidates.Any(guest => guest.UserId.HasValue))
        {
            throw new ArgumentException("اطلاعات تماس حساب با پرونده مهمان دیگری تداخل دارد.");
        }

        if (candidates.Count == 1)
        {
            var candidate = candidates[0];
            candidate.UserId = clientId;
            candidate.FirstName = string.IsNullOrWhiteSpace(candidate.FirstName)
                ? user.FirstName
                : candidate.FirstName;
            candidate.LastName = string.IsNullOrWhiteSpace(candidate.LastName)
                ? user.LastName
                : candidate.LastName;
            candidate.Mobile ??= mobile;
            candidate.NormalizedMobile ??= mobile;
            candidate.Email ??= email;
            candidate.NormalizedEmail ??= email;
            candidate.Nationality ??= "ایران";
            return candidate;
        }

        var newGuest = new Guest
        {
            UserId = clientId,
            FirstName = user.FirstName,
            LastName = user.LastName,
            Mobile = mobile,
            NormalizedMobile = mobile,
            Email = email,
            NormalizedEmail = email,
            Nationality = "ایران"
        };
        dbContext.Guests.Add(newGuest);
        return newGuest;
    }

    private async Task ApplySelfGuestUpdatesAsync(
        NormalizedPrimaryGuest input,
        Guest guest,
        int clientId,
        CancellationToken cancellationToken)
    {
        if (input.Mobile is not null &&
            !string.Equals(input.Mobile, guest.NormalizedMobile, StringComparison.Ordinal))
        {
            var variants = UserIdentityNormalization.BuildPhoneNumberVariants(input.Mobile);
            var conflicts = await dbContext.Guests.AnyAsync(
                                other => other.Id != guest.Id && other.NormalizedMobile == input.Mobile,
                                cancellationToken) ||
                            await dbContext.Users.IgnoreQueryFilters().AnyAsync(
                                other => other.Id != clientId &&
                                         other.PhoneNumber != null &&
                                         variants.Contains(other.PhoneNumber),
                                cancellationToken);
            if (conflicts)
            {
                throw new ArgumentException("این شماره موبایل قبلاً برای حساب یا مهمان دیگری ثبت شده است.");
            }
        }

        if (input.Email is not null &&
            !string.Equals(input.Email, guest.NormalizedEmail, StringComparison.OrdinalIgnoreCase))
        {
            var conflicts = await dbContext.Guests.AnyAsync(
                                other => other.Id != guest.Id && other.NormalizedEmail == input.Email,
                                cancellationToken) ||
                            await dbContext.Users.IgnoreQueryFilters().AnyAsync(
                                other => other.Id != clientId && other.Email == input.Email,
                                cancellationToken);
            if (conflicts)
            {
                throw new ArgumentException("این ایمیل قبلاً برای حساب یا مهمان دیگری ثبت شده است.");
            }
        }

        if (input.FirstName is not null) guest.FirstName = input.FirstName;
        if (input.LastName is not null) guest.LastName = input.LastName;
        if (input.Mobile is not null)
        {
            guest.Mobile = input.Mobile;
            guest.NormalizedMobile = input.Mobile;
        }
        if (input.Email is not null)
        {
            guest.Email = input.Email;
            guest.NormalizedEmail = input.Email;
        }
        if (input.NationalCode is not null) guest.NationalCode = input.NationalCode;
    }

    private static bool IsInternalUserEmail(string? email) =>
        email?.EndsWith("@mobile.kooch.local", StringComparison.OrdinalIgnoreCase) == true;

    private static void EnsureContactsDoNotConflict(
        NormalizedPrimaryGuest input,
        string? storedMobile,
        string? storedEmail)
    {
        if ((input.Mobile is not null && !string.Equals(input.Mobile, storedMobile, StringComparison.Ordinal)) ||
            (input.Email is not null && !string.Equals(input.Email, storedEmail, StringComparison.OrdinalIgnoreCase)))
        {
            throw new ArgumentException("اطلاعات تماس مهمان با پرونده موجود هم‌خوانی ندارد.");
        }
    }

    private static void ApplyNationalCodeIfProvided(string? nationalCode, Guest guest)
    {
        if (nationalCode is null || string.Equals(guest.NationalCode, nationalCode, StringComparison.Ordinal))
        {
            return;
        }

        if (guest.NationalCode is not null)
        {
            throw new ArgumentException("کد ملی مهمان با پرونده موجود هم‌خوانی ندارد.");
        }

        guest.NationalCode = nationalCode;
    }

    private static void ValidateRequest(BookingSessionCreateRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.ClientId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(request.ClientId));
        }

        if (request.GuestId is <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(request.GuestId));
        }

        if (request.PropertyId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(request.PropertyId));
        }

        if (request.Items is null || request.Items.Count == 0)
        {
            throw new ArgumentException(
                "A booking session must contain at least one reservation item.",
                nameof(request));
        }

        var normalizedIdempotencyKey = NormalizeIdempotencyKey(request.IdempotencyKey);
        if (normalizedIdempotencyKey?.Length > 200)
        {
            throw new ArgumentException(
                "Idempotency key cannot exceed 200 characters.",
                nameof(request));
        }

        foreach (var item in request.Items)
        {
            if (item.RoomTypeId <= 0 || item.RoomId is <= 0)
            {
                throw new ArgumentException("Room allocation identifiers must be positive.", nameof(request));
            }

            if (item.CheckInDate >= item.CheckOutDate)
            {
                throw new ArgumentException("Invalid reservation date range.", nameof(request));
            }

            if (item.Adults <= 0 || item.Children < 0)
            {
                throw new ArgumentException("Invalid reservation guest counts.", nameof(request));
            }

            if (item.ChildAges is null || item.ChildAges.Count != item.Children)
            {
                throw new ArgumentException(
                    "A child age must be supplied for every child.",
                    nameof(request));
            }

            if (item.Notes?.Length > 2000)
            {
                throw new ArgumentException(
                    "Reservation notes cannot exceed 2000 characters.",
                    nameof(request));
            }
        }

        var duplicateRoomId = request.Items
            .Where(item => item.RoomId.HasValue)
            .GroupBy(item => item.RoomId!.Value)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicateRoomId is not null)
        {
            throw new InvalidOperationException(
                $"Room {duplicateRoomId.Key} cannot be allocated more than once in a booking session.");
        }
    }

    private async Task ValidateClientAndGuestAsync(
        BookingSessionCreateRequest request,
        CancellationToken cancellationToken)
    {
        var clientExists = await dbContext.Users.AsNoTracking()
            .AnyAsync(user => user.Id == request.ClientId && user.IsActive, cancellationToken);
        if (!clientExists)
        {
            throw new KeyNotFoundException("Client not found.");
        }

        if (request.GuestId.HasValue)
        {
            var guestExists = await dbContext.Guests.AsNoTracking()
                .AnyAsync(guest => guest.Id == request.GuestId.Value, cancellationToken);
            if (!guestExists)
            {
                throw new KeyNotFoundException("Guest not found.");
            }
        }
    }

    private async Task ValidatePropertyAsync(
        int propertyId,
        BookingSessionCreationKind creationKind,
        CancellationToken cancellationToken)
    {
        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");
        if (property.Status is PropertyStatus.Rejected or PropertyStatus.Suspended)
        {
            throw new InvalidOperationException("Property is not available for reservations.");
        }

        if (creationKind == BookingSessionCreationKind.Account &&
            property.Status != PropertyStatus.Approved)
        {
            throw new InvalidOperationException("Property is not available for public booking.");
        }
    }

    private async Task<IReadOnlyDictionary<int, RoomType>> LockRoomTypesAsync(
        IReadOnlyList<int> roomTypeIds,
        CancellationToken cancellationToken)
    {
        var roomTypes = new Dictionary<int, RoomType>();
        foreach (var roomTypeId in roomTypeIds)
        {
            var roomType = dbContext.Database.IsSqlServer()
                ? await dbContext.RoomTypes
                    .FromSqlInterpolated(
                        $"SELECT * FROM RoomTypes WITH (UPDLOCK, HOLDLOCK) WHERE Id = {roomTypeId}")
                    .AsNoTracking()
                    .SingleOrDefaultAsync(cancellationToken)
                : await dbContext.RoomTypes.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == roomTypeId, cancellationToken);
            if (roomType is null || !roomType.IsActive)
            {
                throw new KeyNotFoundException("Room type not found.");
            }

            roomTypes.Add(roomType.Id, roomType);
        }

        return roomTypes;
    }

    private async Task<IReadOnlyDictionary<int, Room>> LockRoomsAsync(
        IReadOnlyList<int> roomIds,
        CancellationToken cancellationToken)
    {
        var rooms = new Dictionary<int, Room>();
        foreach (var roomId in roomIds)
        {
            var room = dbContext.Database.IsSqlServer()
                ? await dbContext.Rooms
                    .FromSqlInterpolated(
                        $"SELECT * FROM Rooms WITH (UPDLOCK, HOLDLOCK) WHERE Id = {roomId}")
                    .AsNoTracking()
                    .SingleOrDefaultAsync(cancellationToken)
                : await dbContext.Rooms.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == roomId, cancellationToken);
            if (room is null || !room.IsActive)
            {
                throw new KeyNotFoundException("Room not found.");
            }

            rooms.Add(room.Id, room);
        }

        return rooms;
    }

    private static void ValidateRoomRelationships(
        BookingSessionCreateRequest request,
        IReadOnlyDictionary<int, RoomType> roomTypes,
        IReadOnlyDictionary<int, Room> rooms)
    {
        foreach (var item in request.Items)
        {
            var roomType = roomTypes[item.RoomTypeId];
            if (roomType.PropertyId != request.PropertyId)
            {
                throw new ArgumentException(
                    "All reservation items must belong to the booking session property.");
            }

            if (item.RoomId.HasValue && rooms[item.RoomId.Value].RoomTypeId != item.RoomTypeId)
            {
                throw new ArgumentException(
                    "Selected room does not belong to the selected room type.");
            }
        }
    }

    private async Task<IReadOnlyList<PreparedBookingItem>> PrepareItemsAsync(
        BookingSessionCreateRequest request,
        BookingSessionCreationKind creationKind,
        CancellationToken cancellationToken)
    {
        var indexedItems = request.Items
            .Select((item, index) => new IndexedBookingItem(index, item))
            .ToArray();
        var onRequestByIndex = new bool[indexedItems.Length];

        foreach (var group in indexedItems.GroupBy(entry => entry.Item.RoomTypeId))
        {
            var checkInDate = group.Min(entry => entry.Item.CheckInDate);
            var checkOutDate = group.Max(entry => entry.Item.CheckOutDate);
            var availability = await effectiveAvailabilityService.GetRangeAsync(
                [group.Key],
                checkInDate,
                checkOutDate,
                cancellationToken: cancellationToken);
            if (!availability.TryGetValue(group.Key, out var roomTypeAvailability))
            {
                throw CapacityChangedException();
            }

            for (var date = checkInDate; date < checkOutDate; date = date.AddDays(1))
            {
                var demand = group.Count(entry =>
                    entry.Item.CheckInDate <= date &&
                    entry.Item.CheckOutDate > date);
                if (demand == 0)
                {
                    continue;
                }

                if (!roomTypeAvailability.Nights.TryGetValue(date, out var night) ||
                    night.IsClosed ||
                    night.ConfiguredStatus is not (AvailabilityStatus.Available or AvailabilityStatus.OnRequest) ||
                    night.RemainingCapacity < demand)
                {
                    throw CapacityChangedException();
                }
            }

            foreach (var entry in group)
            {
                onRequestByIndex[entry.Index] = roomTypeAvailability.Nights.Values.Any(night =>
                    night.Date >= entry.Item.CheckInDate &&
                    night.Date < entry.Item.CheckOutDate &&
                    night.ConfiguredStatus == AvailabilityStatus.OnRequest);

                if (entry.Item.RoomId.HasValue)
                {
                    var itemAvailability = await effectiveAvailabilityService.GetRangeAsync(
                        [entry.Item.RoomTypeId],
                        entry.Item.CheckInDate,
                        entry.Item.CheckOutDate,
                        cancellationToken: cancellationToken);
                    if (!itemAvailability.TryGetValue(
                            entry.Item.RoomTypeId,
                            out var namedRoomAvailability) ||
                        namedRoomAvailability.ClaimedRoomIds.Contains(entry.Item.RoomId.Value))
                    {
                        throw CapacityChangedException();
                    }
                }
            }
        }

        var preparedItems = new List<PreparedBookingItem>(request.Items.Count);
        for (var index = 0; index < request.Items.Count; index++)
        {
            var item = request.Items[index];
            var priceRequest = new ReservationPricePreviewRequest
            {
                    PropertyId = request.PropertyId,
                    RoomTypeId = item.RoomTypeId,
                    CheckInDate = item.CheckInDate,
                    CheckOutDate = item.CheckOutDate,
                    Adults = item.Adults,
                    Children = item.Children,
                    ChildAges = item.ChildAges,
                    RoomCount = 1,
                    GuestType = item.GuestType
            };
            var price = creationKind == BookingSessionCreationKind.Account
                ? await pricingService.PreviewPublicBookingPriceAsync(priceRequest, cancellationToken)
                : await pricingService.PreviewReservationPriceAsync(priceRequest, cancellationToken);
            if (price.PropertyId != request.PropertyId || price.RoomTypeId != item.RoomTypeId)
            {
                throw new InvalidOperationException(
                    "Pricing result does not match the reservation item.");
            }

            var status = creationKind == BookingSessionCreationKind.Account
                ? onRequestByIndex[index]
                    ? ReservationStatus.PendingApproval
                    : ReservationStatus.ApprovedAwaitingPayment
                : item.Status ??
                  (onRequestByIndex[index]
                      ? ReservationStatus.PendingApproval
                      : ReservationStatus.Pending);
            if (creationKind == BookingSessionCreationKind.Internal)
            {
                statusWorkflow.ValidateManualCreationStatus(onRequestByIndex[index], status);
            }

            preparedItems.Add(new PreparedBookingItem(
                item,
                price,
                NormalizeCurrency(price.Currency),
                ReservationStatusNormalizer.Normalize(status),
                onRequestByIndex[index]));
        }

        return preparedItems;
    }

    private static string AssertSameCurrency(IReadOnlyList<PreparedBookingItem> preparedItems)
    {
        var currency = preparedItems[0].Currency;
        if (preparedItems.Any(item =>
                !string.Equals(item.Currency, currency, StringComparison.Ordinal)))
        {
            throw new InvalidOperationException(
                "All reservations in a booking session must use the same currency.");
        }

        return currency;
    }

    private static void ValidateAccountBookingMode(
        IReadOnlyList<PreparedBookingItem> preparedItems,
        BookingSessionCreationKind creationKind)
    {
        if (creationKind == BookingSessionCreationKind.Account &&
            preparedItems.Select(item => item.IsOnRequest).Distinct().Skip(1).Any())
        {
            throw new InvalidOperationException(
                "Instant and on-request reservations cannot be combined in one booking session.");
        }
    }

    private async Task<BookingSession?> FindExistingSessionAsync(
        int clientId,
        string idempotencyKey,
        CancellationToken cancellationToken) =>
        await dbContext.BookingSessions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Include(session => session.Reservations)
            .SingleOrDefaultAsync(
                session =>
                    session.ClientId == clientId &&
                    session.IdempotencyKey == idempotencyKey,
                cancellationToken);

    private async Task AcquireIdempotencyDatabaseLockAsync(
        int clientId,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!dbContext.Database.IsSqlServer())
        {
            return;
        }

        var keyHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(idempotencyKey)));
        var resource = $"Kooch:BookingSession:{clientId}:{keyHash}";
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock
                @Resource = {resource},
                @LockMode = 'Exclusive',
                @LockOwner = 'Transaction',
                @LockTimeout = 10000;
            IF @result < 0
                THROW 51000, 'Could not acquire the booking session idempotency lock.', 1;
            """,
            cancellationToken);
    }

    private static IReadOnlyList<string> BuildLocalResourceNames(
        int clientId,
        string? idempotencyKey,
        BookingSessionLockOrder lockOrder)
    {
        var resources = new List<string>();
        if (idempotencyKey is not null)
        {
            var keyHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(idempotencyKey)));
            resources.Add($"0-idempotency:{clientId:D10}:{keyHash}");
        }

        resources.AddRange(lockOrder.RoomTypeIds.Select(id => $"1-room-type:{id:D10}"));
        resources.AddRange(lockOrder.RoomIds.Select(id => $"2-room:{id:D10}"));
        return resources.Order(StringComparer.Ordinal).ToArray();
    }

    private static async Task<LocalResourceLockScope> AcquireLocalResourceLocksAsync(
        IReadOnlyList<string> resources,
        CancellationToken cancellationToken)
    {
        var acquiredLocks = new List<SemaphoreSlim>(resources.Count);
        try
        {
            foreach (var resource in resources)
            {
                var resourceLock = LocalResourceLocks.GetOrAdd(
                    resource,
                    static _ => new SemaphoreSlim(1, 1));
                await resourceLock.WaitAsync(cancellationToken);
                acquiredLocks.Add(resourceLock);
            }

            return new LocalResourceLockScope(acquiredLocks);
        }
        catch
        {
            for (var index = acquiredLocks.Count - 1; index >= 0; index--)
            {
                acquiredLocks[index].Release();
            }

            throw;
        }
    }

    private static string NormalizeCurrency(string currency)
    {
        var normalized = currency?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(normalized) || normalized.Length > 3)
        {
            throw new InvalidOperationException("Pricing returned an invalid currency.");
        }

        return normalized;
    }

    private static string? NormalizeOptionalText(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

    private static InvalidOperationException CapacityChangedException() =>
        new("Availability changed. There is no longer enough capacity for the selected dates.");

    private static BookingSessionCreateResult ToResult(BookingSession session) =>
        new()
        {
            BookingSessionId = session.Id,
            SessionCode = session.SessionCode,
            ClientId = session.ClientId,
            GuestId = session.GuestId,
            PropertyId = session.PropertyId,
            Currency = session.Currency,
            Reservations = session.Reservations
                .OrderBy(reservation => reservation.Id)
                .Select(reservation => new BookingSessionReservationResult
                {
                    ReservationId = reservation.Id,
                    ReservationNumber = reservation.ReservationNumber ?? string.Empty,
                    RoomTypeId = reservation.RoomTypeId,
                    RoomId = reservation.RoomId,
                    CheckInDate = reservation.CheckInDate,
                    CheckOutDate = reservation.CheckOutDate,
                    Status = reservation.Status,
                    FinalAmount = reservation.FinalAmount,
                    Currency = reservation.Currency
                })
                .ToArray()
        };

    internal sealed record BookingSessionLockOrder(
        IReadOnlyList<int> RoomTypeIds,
        IReadOnlyList<int> RoomIds);

    private sealed record IndexedBookingItem(
        int Index,
        BookingSessionReservationCreateItem Item);

    private enum BookingSessionCreationKind
    {
        Internal,
        Account
    }

    private sealed record PreparedBookingItem(
        BookingSessionReservationCreateItem Item,
        ReservationPricePreviewResponse Price,
        string Currency,
        ReservationStatus Status,
        bool IsOnRequest);

    private sealed record CanonicalBookingRequest(
        int ClientId,
        int? GuestId,
        int PropertyId,
        IReadOnlyList<CanonicalBookingItem> Items);

    private sealed record CanonicalAccountBookingRequest(
        string BookingHash,
        bool BookingForSelf,
        string? ExpectedArrivalTime,
        string? SpecialRequest,
        CanonicalPrimaryGuest? PrimaryGuest);

    private sealed record CanonicalAccountBookingRequestWithNationalCode(
        string BookingHash,
        bool BookingForSelf,
        string? ExpectedArrivalTime,
        string? SpecialRequest,
        CanonicalPrimaryGuestWithNationalCode PrimaryGuest);

    private sealed record CanonicalPrimaryGuest(
        string? FirstName,
        string? LastName,
        string? Mobile,
        string? Email);

    private sealed record CanonicalPrimaryGuestWithNationalCode(
        string? FirstName,
        string? LastName,
        string? Mobile,
        string? Email,
        string NationalCode);

    private sealed record CanonicalBookingItem(
        int RoomTypeId,
        int? RoomId,
        string CheckInDate,
        string CheckOutDate,
        int Adults,
        int Children,
        IReadOnlyList<int> ChildAges,
        int GuestType,
        int? Status,
        string? Notes);

    private sealed record AccountBookingContext(
        bool BookingForSelf,
        NormalizedPrimaryGuest? PrimaryGuest,
        TimeOnly? ExpectedArrivalTime,
        string? SpecialRequest);

    private sealed record NormalizedPrimaryGuest(
        string? FirstName,
        string? LastName,
        string? Mobile,
        string? Email,
        string? NationalCode);

    private sealed record PrimaryGuestAssignment(
        int? GuestId,
        Guest? NewGuest);

    private sealed class LocalResourceLockScope(IReadOnlyList<SemaphoreSlim> acquiredLocks) : IAsyncDisposable
    {
        public ValueTask DisposeAsync()
        {
            for (var index = acquiredLocks.Count - 1; index >= 0; index--)
            {
                acquiredLocks[index].Release();
            }

            return ValueTask.CompletedTask;
        }
    }
}
