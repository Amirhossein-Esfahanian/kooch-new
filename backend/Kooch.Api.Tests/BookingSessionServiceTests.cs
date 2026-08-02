using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionServiceTests
{
    [Fact]
    public async Task OneItem_CreatesOneSessionAndOneIndependentReservation()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateRequest(CreateItem(10, 100));
        request.IdempotencyKey = "   ";

        var result = await scope.Service.CreateAsync(request);

        Assert.NotEqual(0, result.BookingSessionId);
        Assert.StartsWith("KCH-S-", result.SessionCode);
        var reservation = Assert.Single(result.Reservations);
        Assert.NotEqual(0, reservation.ReservationId);
        Assert.StartsWith("KCH-", reservation.ReservationNumber);
        Assert.Equal(ReservationStatus.Pending, reservation.Status);

        await using var verification = harness.CreateContext();
        var persisted = await verification.BookingSessions
            .Include(session => session.Reservations)
            .SingleAsync();
        Assert.Null(persisted.IdempotencyKey);
        Assert.Equal(64, persisted.RequestHash?.Length);
        var persistedReservation = Assert.Single(persisted.Reservations);
        Assert.Equal(persisted.Id, persistedReservation.BookingSessionId);
        Assert.Equal(ReservationSource.Website, persistedReservation.Source);
    }

    [Fact]
    public async Task MultipleItems_CreateIndependentUniqueReservationNumbers()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateAsync(
            CreateRequest(
                CreateItem(10, 100),
                CreateItem(20, 200)));

        Assert.Equal(2, result.Reservations.Count);
        Assert.Equal(
            2,
            result.Reservations
                .Select(reservation => reservation.ReservationNumber)
                .Distinct(StringComparer.Ordinal)
                .Count());
        Assert.All(
            result.Reservations,
            reservation => Assert.NotEqual(0, reservation.ReservationId));
    }

    [Fact]
    public async Task OnRequestItem_UsesTheExistingPendingApprovalLifecycle()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Availabilities.Add(new Availability
            {
                RoomTypeId = 10,
                Date = new DateOnly(2035, 2, 1),
                AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        var result = await scope.Service.CreateAsync(CreateRequest(CreateItem(10, 100)));

        Assert.Equal(
            ReservationStatus.PendingApproval,
            Assert.Single(result.Reservations).Status);
    }

    [Fact]
    public async Task AccountInstantSession_HoldsCapacityAndUsesOneSharedDeadline()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        var before = DateTime.UtcNow.AddMinutes(45);
        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(
                CreateAccountItem(10, 100),
                CreateAccountItem(20, 200)));
        var after = DateTime.UtcNow.AddMinutes(45);

        Assert.All(result.Reservations, reservation =>
            Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
        await using var verification = harness.CreateContext();
        var persisted = await verification.Reservations
            .Where(reservation => reservation.BookingSessionId == result.BookingSessionId)
            .OrderBy(reservation => reservation.Id)
            .ToListAsync();
        var deadline = Assert.Single(
            persisted.Select(reservation => reservation.PaymentExpiresAtUtc).Distinct());
        Assert.NotNull(deadline);
        Assert.InRange(deadline.Value, before, after);
        Assert.All(persisted, reservation => Assert.NotNull(reservation.ApprovedAtUtc));

        var availability = await new EffectiveAvailabilityService(verification).GetRangeAsync(
            [10],
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3));
        Assert.All(availability[10].Nights.Values, night =>
            Assert.Equal(1, night.RemainingCapacity));
    }

    [Fact]
    public async Task AccountOnRequestSession_StartsPendingWithoutPaymentDeadline()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Availabilities.Add(new Availability
            {
                RoomTypeId = 10,
                Date = new DateOnly(2035, 2, 1),
                AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(CreateAccountItem(10, 100)));

        Assert.Equal(
            ReservationStatus.PendingApproval,
            Assert.Single(result.Reservations).Status);
        await using var verification = harness.CreateContext();
        Assert.Null((await verification.Reservations.SingleAsync()).PaymentExpiresAtUtc);
    }

    [Fact]
    public async Task AccountSession_RejectsMixedModesAndDifferentProperties()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Availabilities.Add(new Availability
            {
                RoomTypeId = 10,
                Date = new DateOnly(2035, 2, 1),
                AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateAccountRequest(
                    CreateAccountItem(10, 100),
                    CreateAccountItem(20, 200))));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateAccountRequest(
                    CreateAccountItem(10, 100),
                    CreateAccountItem(30, 300))));
    }

    [Fact]
    public async Task AccountSession_PreservesIdempotentReplay()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));

        var first = await scope.Service.CreateForAccountAsync(1, request);
        var replay = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(first.BookingSessionId, replay.BookingSessionId);
        Assert.Equal(
            Assert.Single(first.Reservations).ReservationId,
            Assert.Single(replay.Reservations).ReservationId);
    }

    [Fact]
    public async Task FailurePreparingSecondItem_RollsBackTheCompleteSession()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var pricing = new TestReservationPricingService { ThrowOnCall = 2 };
        await using var scope = harness.CreateService(pricing);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(
                CreateRequest(
                    CreateItem(10, 100),
                    CreateItem(20, 200))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task RoomTypeFromAnotherProperty_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<ArgumentException>(
            () => scope.Service.CreateAsync(CreateRequest(CreateItem(30, 300))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task DifferentCurrencies_AreRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var pricing = new TestReservationPricingService
        {
            CurrencyForRoomType = roomTypeId => roomTypeId == 10 ? "IRR" : "USD"
        };
        await using var scope = harness.CreateService(pricing);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(
                CreateRequest(
                    CreateItem(10, 100),
                    CreateItem(20, 200))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task DuplicateNamedRoom_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(
                CreateRequest(
                    CreateItem(10, 100),
                    CreateItem(10, 100))));
    }

    [Fact]
    public async Task InsufficientCapacity_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Reservations.Add(CreateConsumingReservation(40));
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        var item = CreateItem(40, roomId: null);
        item.Status = ReservationStatus.Confirmed;

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(CreateRequest(item)));
    }

    [Fact]
    public async Task ConcurrentRequests_CannotBothTakeTheLastCapacity()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var firstScope = harness.CreateService();
        await using var secondScope = harness.CreateService();
        var firstItem = CreateItem(40, roomId: null);
        firstItem.Status = ReservationStatus.Confirmed;
        var secondItem = CreateItem(40, roomId: null);
        secondItem.Status = ReservationStatus.Confirmed;

        var attempts = await Task.WhenAll(
            TryCreateAsync(firstScope.Service, CreateRequest(firstItem)),
            TryCreateAsync(secondScope.Service, CreateRequest(secondItem)));

        Assert.Single(attempts, attempt => attempt.Result is not null);
        Assert.Single(attempts, attempt => attempt.Error is InvalidOperationException);

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Single(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public void LockOrder_IsDeterministicAndAscending()
    {
        var items = new[]
        {
            CreateItem(20, 300),
            CreateItem(10, 200),
            CreateItem(20, 100),
            CreateItem(10, roomId: null)
        };

        var order = BookingSessionService.BuildLockOrder(items);

        Assert.Equal([10, 20], order.RoomTypeIds);
        Assert.Equal([100, 200, 300], order.RoomIds);
    }

    [Fact]
    public async Task SameClientKeyAndCanonicalPayload_ReturnsTheExistingSession()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var firstRequest = CreateRequest(
            CreateItem(20, 200, notes: " second "),
            CreateItem(10, 100, notes: "first"));
        firstRequest.IdempotencyKey = "  checkout-42  ";

        var first = await scope.Service.CreateAsync(firstRequest);

        var replayRequest = CreateRequest(
            CreateItem(10, 100, notes: " first "),
            CreateItem(20, 200, notes: "second"));
        replayRequest.IdempotencyKey = "checkout-42";
        var replay = await scope.Service.CreateAsync(replayRequest);

        Assert.Equal(first.BookingSessionId, replay.BookingSessionId);
        Assert.Equal(first.SessionCode, replay.SessionCode);
        Assert.Equal(
            first.Reservations.Select(item => item.ReservationNumber).Order().ToArray(),
            replay.Reservations.Select(item => item.ReservationNumber).Order().ToArray());

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Equal(2, await verification.Reservations.CountAsync());
        var persisted = await verification.BookingSessions.SingleAsync();
        Assert.Equal("checkout-42", persisted.IdempotencyKey);
        Assert.Equal(64, persisted.RequestHash?.Length);
    }

    [Fact]
    public async Task SameClientKeyWithDifferentPayload_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateRequest(CreateItem(10, 100, notes: "original"));
        original.IdempotencyKey = "checkout-43";
        await scope.Service.CreateAsync(original);

        var changed = CreateRequest(CreateItem(10, 100, notes: "changed"));
        changed.IdempotencyKey = " checkout-43 ";

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(changed));
        Assert.Contains("different booking payload", exception.Message, StringComparison.Ordinal);

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Single(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task ExistingStandaloneReservation_RemainsSessionlessAndValid()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        int standaloneId;
        await using (var setup = harness.CreateContext())
        {
            var standalone = new Reservation
            {
                ReservationNumber = "KCH-LEGACY-STANDALONE",
                ClientId = 1,
                GuestId = 1,
                PropertyId = 1,
                RoomTypeId = 10,
                RoomId = 100,
                CheckInDate = new DateOnly(2035, 1, 1),
                CheckOutDate = new DateOnly(2035, 1, 2),
                AdultCount = 1,
                Currency = "IRR",
                Status = ReservationStatus.Pending
            };
            setup.Reservations.Add(standalone);
            await setup.SaveChangesAsync();
            standaloneId = standalone.Id;
        }

        await using var scope = harness.CreateService();
        await scope.Service.CreateAsync(CreateRequest(CreateItem(20, 200)));

        await using var verification = harness.CreateContext();
        var persistedStandalone = await verification.Reservations.SingleAsync(
            reservation => reservation.Id == standaloneId);
        Assert.Null(persistedStandalone.BookingSessionId);
        Assert.Equal("KCH-LEGACY-STANDALONE", persistedStandalone.ReservationNumber);
    }

    private static async Task<CreateAttempt> TryCreateAsync(
        IBookingSessionService service,
        BookingSessionCreateRequest request)
    {
        try
        {
            return new CreateAttempt(await service.CreateAsync(request), null);
        }
        catch (Exception exception)
        {
            return new CreateAttempt(null, exception);
        }
    }

    private static BookingSessionCreateRequest CreateRequest(
        params BookingSessionReservationCreateItem[] items) =>
        new()
        {
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            Items = items
        };

    private static BookingSessionReservationCreateItem CreateItem(
        int roomTypeId,
        int? roomId,
        string? notes = null) =>
        new()
        {
            RoomTypeId = roomTypeId,
            RoomId = roomId,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            Adults = 1,
            Notes = notes
        };

    private static AccountBookingSessionCreateRequest CreateAccountRequest(
        params AccountBookingSessionReservationCreateItem[] items) =>
        new()
        {
            IdempotencyKey = Guid.NewGuid().ToString("N"),
            Items = items
        };

    private static AccountBookingSessionReservationCreateItem CreateAccountItem(
        int roomTypeId,
        int? roomId) =>
        new()
        {
            RoomTypeId = roomTypeId,
            RoomId = roomId,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            Adults = 1
        };

    private static Reservation CreateConsumingReservation(int roomTypeId) =>
        new()
        {
            ReservationNumber = $"KCH-EXISTING-{Guid.NewGuid():N}",
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            RoomTypeId = roomTypeId,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            AdultCount = 1,
            Currency = "IRR",
            Status = ReservationStatus.Confirmed
        };

    private sealed record CreateAttempt(
        BookingSessionCreateResult? Result,
        Exception? Error);

    private sealed class BookingSessionTestHarness : IAsyncDisposable
    {
        private readonly DbContextOptions<KoochDbContext> options;

        private BookingSessionTestHarness(DbContextOptions<KoochDbContext> options)
        {
            this.options = options;
        }

        public static async Task<BookingSessionTestHarness> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"booking-session-service-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var harness = new BookingSessionTestHarness(options);
            await using var context = harness.CreateContext();
            context.Users.Add(new User
            {
                Id = 1,
                FirstName = "Booking",
                LastName = "Client",
                PasswordHash = "hash",
                Role = UserRole.Client,
                IsActive = true
            });
            context.Guests.Add(new Guest
            {
                Id = 1,
                UserId = 1,
                FirstName = "Booking",
                LastName = "Guest"
            });
            context.SiteSettings.Add(new SiteSetting
            {
                Id = 1,
                Key = "reservation.paymentWindowMinutes",
                Value = "45",
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = "Payment window",
                IsActive = true
            });
            context.Properties.AddRange(
                new Property
                {
                    Id = 1,
                    OwnerId = 1,
                    DestinationId = 1,
                    Name = "Property One",
                    Slug = "property-one",
                    Description = "Test property",
                    Address = "Address",
                    City = "City",
                    Country = "IR",
                    Status = PropertyStatus.Approved
                },
                new Property
                {
                    Id = 2,
                    OwnerId = 1,
                    DestinationId = 1,
                    Name = "Property Two",
                    Slug = "property-two",
                    Description = "Test property",
                    Address = "Address",
                    City = "City",
                    Country = "IR",
                    Status = PropertyStatus.Approved
                });
            context.RoomTypes.AddRange(
                CreateRoomType(10, 1, 2),
                CreateRoomType(20, 1, 2),
                CreateRoomType(30, 2, 2),
                CreateRoomType(40, 1, 1, InventoryMode.TypeBasedInventory));
            context.Rooms.AddRange(
                CreateRoom(100, 10),
                CreateRoom(200, 20),
                CreateRoom(300, 30));
            await context.SaveChangesAsync();
            return harness;
        }

        public KoochDbContext CreateContext() => new(options);

        public ServiceScope CreateService(TestReservationPricingService? pricing = null)
        {
            var context = CreateContext();
            var service = new BookingSessionService(
                context,
                new EffectiveAvailabilityService(context),
                pricing ?? new TestReservationPricingService(),
                new ReservationStatusWorkflow(),
                new ReservationNumberGenerator(context),
                new BookingSessionCodeGenerator());
            return new ServiceScope(context, service);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private static RoomType CreateRoomType(
            int id,
            int propertyId,
            int inventory,
            InventoryMode inventoryMode = InventoryMode.NamedRooms) =>
            new()
            {
                Id = id,
                PropertyId = propertyId,
                Name = $"Room Type {id}",
                Slug = $"room-type-{id}",
                Description = "Test room type",
                MaxAdults = 2,
                MaxChildren = 2,
                TotalInventory = inventory,
                InventoryMode = inventoryMode,
                BasePrice = 100,
                IsActive = true
            };

        private static Room CreateRoom(int id, int roomTypeId) =>
            new()
            {
                Id = id,
                RoomTypeId = roomTypeId,
                Name = $"Room {id}",
                IsActive = true
            };
    }

    private sealed class ServiceScope(
        KoochDbContext context,
        BookingSessionService service) : IAsyncDisposable
    {
        public BookingSessionService Service { get; } = service;

        public async ValueTask DisposeAsync()
        {
            await context.DisposeAsync();
        }
    }

    private sealed class TestReservationPricingService : IReservationPricingService
    {
        private int callCount;

        public int? ThrowOnCall { get; init; }
        public Func<int, string> CurrencyForRoomType { get; init; } = _ => "IRR";

        public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default)
        {
            var currentCall = Interlocked.Increment(ref callCount);
            if (ThrowOnCall == currentCall)
            {
                throw new InvalidOperationException("Pricing failed for the requested item.");
            }

            return Task.FromResult(new ReservationPricePreviewResponse
            {
                PropertyId = request.PropertyId,
                RoomTypeId = request.RoomTypeId,
                GuestType = request.GuestType,
                CheckInDate = request.CheckInDate,
                CheckOutDate = request.CheckOutDate,
                NightsCount = request.CheckOutDate.DayNumber - request.CheckInDate.DayNumber,
                Adults = request.Adults,
                Children = request.Children,
                RoomCount = 1,
                BaseAmount = 100,
                FinalAmount = 100,
                Currency = CurrencyForRoomType(request.RoomTypeId)
            });
        }
    }
}
