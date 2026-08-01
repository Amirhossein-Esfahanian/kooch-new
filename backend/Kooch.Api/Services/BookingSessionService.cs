using System.Collections.Concurrent;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class BookingSessionService(
    KoochDbContext dbContext,
    IEffectiveAvailabilityService effectiveAvailabilityService,
    IReservationPricingService pricingService,
    IReservationStatusWorkflow statusWorkflow,
    IReservationNumberGenerator reservationNumberGenerator,
    IBookingSessionCodeGenerator sessionCodeGenerator) : IBookingSessionService
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> LocalResourceLocks = new();

    public async Task<BookingSessionCreateResult> CreateAsync(
        BookingSessionCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        ValidateRequest(request);
        var normalizedIdempotencyKey = NormalizeIdempotencyKey(request.IdempotencyKey);
        var requestHash = ComputeRequestHash(request);
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
        await ValidatePropertyAsync(request.PropertyId, cancellationToken);
        var roomTypes = await LockRoomTypesAsync(lockOrder.RoomTypeIds, cancellationToken);
        var rooms = await LockRoomsAsync(lockOrder.RoomIds, cancellationToken);
        ValidateRoomRelationships(request, roomTypes, rooms);

        var preparedItems = await PrepareItemsAsync(request, cancellationToken);
        var currency = AssertSameCurrency(preparedItems);
        var reservationNumbers = await reservationNumberGenerator.GenerateBatchAsync(
            preparedItems.Count,
            DateTime.UtcNow,
            cancellationToken);
        var now = DateTime.UtcNow;
        var session = new BookingSession
        {
            SessionCode = sessionCodeGenerator.Generate(),
            ClientId = request.ClientId,
            GuestId = request.GuestId,
            PropertyId = request.PropertyId,
            Currency = currency,
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
                GuestId = request.GuestId,
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
                ConfirmedAtUtc = prepared.Status == ReservationStatus.Confirmed ? now : null,
                Source = ReservationSource.Website,
                GuestNote = NormalizeOptionalText(prepared.Item.Notes)
            });
        }

        dbContext.BookingSessions.Add(session);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToResult(session);
    }

    internal static string? NormalizeIdempotencyKey(string? idempotencyKey)
    {
        var normalized = idempotencyKey?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

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

    internal static BookingSessionLockOrder BuildLockOrder(
        IReadOnlyCollection<BookingSessionReservationCreateItem> items) =>
        new(
            items.Select(item => item.RoomTypeId).Distinct().Order().ToArray(),
            items.Where(item => item.RoomId.HasValue)
                .Select(item => item.RoomId!.Value)
                .Distinct()
                .Order()
                .ToArray());

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

    private async Task ValidatePropertyAsync(int propertyId, CancellationToken cancellationToken)
    {
        var property = await dbContext.Properties.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == propertyId, cancellationToken)
            ?? throw new KeyNotFoundException("Property not found.");
        if (property.Status is PropertyStatus.Rejected or PropertyStatus.Suspended)
        {
            throw new InvalidOperationException("Property is not available for reservations.");
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
            var price = await pricingService.PreviewReservationPriceAsync(
                new ReservationPricePreviewRequest
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
                },
                cancellationToken);
            if (price.PropertyId != request.PropertyId || price.RoomTypeId != item.RoomTypeId)
            {
                throw new InvalidOperationException(
                    "Pricing result does not match the reservation item.");
            }

            var status = item.Status ??
                         (onRequestByIndex[index]
                             ? ReservationStatus.PendingApproval
                             : ReservationStatus.Pending);
            statusWorkflow.ValidateManualCreationStatus(onRequestByIndex[index], status);
            preparedItems.Add(new PreparedBookingItem(
                item,
                price,
                NormalizeCurrency(price.Currency),
                ReservationStatusNormalizer.Normalize(status)));
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

    private sealed record PreparedBookingItem(
        BookingSessionReservationCreateItem Item,
        ReservationPricePreviewResponse Price,
        string Currency,
        ReservationStatus Status);

    private sealed record CanonicalBookingRequest(
        int ClientId,
        int? GuestId,
        int PropertyId,
        IReadOnlyList<CanonicalBookingItem> Items);

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
