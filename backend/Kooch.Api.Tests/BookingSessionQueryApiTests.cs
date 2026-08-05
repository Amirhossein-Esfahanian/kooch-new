using System.Linq.Expressions;
using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionQueryApiTests
{
    [Fact]
    public async Task GetById_ReturnsProjectedSessionRelationshipsAndChildReservations()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetByIdAsync(10);

        Assert.Equal(10, result.BookingSessionId);
        Assert.Equal("KCH-S-READ-0001", result.SessionCode);
        Assert.Equal("IRR", result.Currency);
        Assert.Equal(1, result.Property.PropertyId);
        Assert.Equal("Read Property", result.Property.Name);
        Assert.Equal(1, result.Client.ClientId);
        Assert.Equal("Client", result.Client.FirstName);
        Assert.NotNull(result.Guest);
        Assert.Equal(1, result.Guest.GuestId);
        Assert.Equal(2, result.Reservations.Count);
        Assert.Contains(
            result.Reservations,
            reservation =>
                reservation.ReservationNumber == "KCH-READ-0001" &&
                reservation.RoomTypeName == "Room Type One" &&
                reservation.RoomName == "Room One" &&
                reservation.FinalAmount == 100);
    }

    [Fact]
    public async Task GetBySessionCode_NormalizesAndReturnsTheSameSession()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetBySessionCodeAsync("  KCH-S-READ-0001  ");

        Assert.Equal(10, result.BookingSessionId);
        Assert.Equal("KCH-S-READ-0001", result.SessionCode);
    }

    [Fact]
    public async Task AccountRead_ReturnsOnlyOwnedSessionWithoutSensitiveIdentity()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetBySessionCodeForClientAsync(
            1,
            " KCH-S-READ-0001 ");

        Assert.Equal("KCH-S-READ-0001", result.SessionCode);
        Assert.Equal(300, result.TotalAmount);
        Assert.Equal(2, result.Reservations.Count);
        Assert.Null(result.Payment);
        Assert.Null(typeof(AccountBookingSessionResponse).GetProperty("Client"));
        Assert.Null(typeof(AccountBookingSessionResponse).GetProperty("Guest"));

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.GetBySessionCodeForClientAsync(2, "KCH-S-READ-0001"));
    }

    [Fact]
    public async Task AccountList_IsOwnedPagedProjectedAndExcludesStandaloneReservations()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        context.Users.Add(new User
        {
            Id = 2,
            FirstName = "Other",
            LastName = "Client",
            PhoneNumber = "09120000002",
            PasswordHash = "hash",
            Role = UserRole.Client,
            IsActive = true
        });
        context.BookingSessions.Add(new BookingSession
        {
            Id = 12,
            SessionCode = "KCH-S-OTHER",
            ClientId = 2,
            PropertyId = 1,
            Currency = "IRR",
            RequestHash = new string('C', 64)
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        harness.QueryCounter.Reset();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetForClientAsync(
            1,
            new AccountBookingSessionListQuery { Page = 1, PageSize = 1 });

        var item = Assert.Single(result.Items);
        Assert.Equal("KCH-S-READ-0001", item.SessionCode);
        Assert.Equal("Read Property", item.Property.Name);
        Assert.Equal(2, item.ReservationCount);
        Assert.Equal(300, item.TotalAmount);
        Assert.Equal("Mixed", item.DerivedStatus);
        Assert.Equal(1, result.TotalCount);
        Assert.Equal(1, result.TotalPages);
        Assert.DoesNotContain(result.Items, value => value.SessionCode == "KCH-S-OTHER");
        Assert.Equal(2, harness.QueryCounter.CompilationCount);
        Assert.Empty(context.ChangeTracker.Entries());
    }

    [Fact]
    public async Task AccountList_ReportsReadyPaymentAndCanonicalDeadline()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var deadline = DateTime.UtcNow.AddMinutes(20);
        var reservations = await context.Reservations
            .Where(reservation => reservation.BookingSessionId == 10)
            .ToListAsync();
        foreach (var reservation in reservations)
        {
            reservation.Status = ReservationStatus.ApprovedAwaitingPayment;
            reservation.PaymentExpiresAtUtc = deadline;
        }
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetForClientAsync(
            1,
            new AccountBookingSessionListQuery());

        var item = Assert.Single(result.Items);
        Assert.True(item.IsPaymentReady);
        Assert.Equal("ReadyForPayment", item.DerivedStatus);
        Assert.Equal(deadline, item.PaymentDeadlineUtc);
    }

    [Fact]
    public async Task AccountList_AppliesPaginationOnTheDatabaseQuery()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var session = new BookingSession
        {
            Id = 13,
            SessionCode = "KCH-S-READ-0002",
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            Currency = "IRR",
            RequestHash = new string('D', 64),
            CreatedAtUtc = DateTime.UtcNow.AddMinutes(1)
        };
        session.Reservations.Add(new Reservation
        {
            Id = 1003,
            ReservationNumber = "KCH-READ-0003",
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            RoomTypeId = 10,
            CheckInDate = new DateOnly(2036, 3, 1),
            CheckOutDate = new DateOnly(2036, 3, 2),
            AdultCount = 1,
            TotalPrice = 75,
            BaseAmount = 75,
            FinalAmount = 75,
            Currency = "IRR",
            Status = ReservationStatus.PendingApproval,
            Source = ReservationSource.Website
        });
        context.BookingSessions.Add(session);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var service = new BookingSessionQueryService(context);

        var firstPage = await service.GetForClientAsync(
            1,
            new AccountBookingSessionListQuery { Page = 1, PageSize = 1 });
        var secondPage = await service.GetForClientAsync(
            1,
            new AccountBookingSessionListQuery { Page = 2, PageSize = 1 });

        Assert.Equal(2, firstPage.TotalCount);
        Assert.Equal(2, firstPage.TotalPages);
        Assert.Single(firstPage.Items);
        Assert.Single(secondPage.Items);
        Assert.NotEqual(firstPage.Items[0].SessionCode, secondPage.Items[0].SessionCode);
    }

    [Fact]
    public void AccountCreateContract_DoesNotAcceptServerOwnedIdentityStatusOrProperty()
    {
        var requestType = typeof(AccountBookingSessionCreateRequest);
        var itemType = typeof(AccountBookingSessionReservationCreateItem);

        Assert.Null(requestType.GetProperty("ClientId"));
        Assert.Null(requestType.GetProperty("GuestId"));
        Assert.Null(requestType.GetProperty("PropertyId"));
        Assert.Null(itemType.GetProperty("Status"));
        Assert.Single(
            typeof(AccountBookingSessionsController)
                .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true));
    }

    [Fact]
    public async Task UnknownOrSoftDeletedSession_IsNotFound()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => service.GetByIdAsync(999));
        await Assert.ThrowsAsync<KeyNotFoundException>(
            () => service.GetBySessionCodeAsync("KCH-S-DELETED"));
    }

    [Fact]
    public async Task DerivedSummary_IsComputedFromCurrentChildReservationStatuses()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetByIdAsync(10);

        Assert.Equal("Mixed", result.Summary.DerivedStatus);
        Assert.Equal(2, result.Summary.ReservationCount);
        Assert.Equal(300, result.Summary.TotalAmount);
        Assert.Equal(new DateOnly(2036, 1, 1), result.Summary.EarliestCheckInDate);
        Assert.Equal(new DateOnly(2036, 1, 5), result.Summary.LatestCheckOutDate);
        Assert.Contains(
            result.Summary.StatusCounts,
            item => item.Status == ReservationStatus.Confirmed && item.Count == 1);
        Assert.Contains(
            result.Summary.StatusCounts,
            item => item.Status == ReservationStatus.PendingApproval && item.Count == 1);
    }

    [Fact]
    public async Task StandaloneReservation_RemainsIndependentAndIsNotIncluded()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetByIdAsync(10);

        Assert.DoesNotContain(
            result.Reservations,
            reservation => reservation.ReservationNumber == "KCH-STANDALONE");
        var standalone = await context.Reservations.AsNoTracking()
            .SingleAsync(reservation => reservation.ReservationNumber == "KCH-STANDALONE");
        Assert.Null(standalone.BookingSessionId);
    }

    [Fact]
    public async Task ReadQuery_UsesOneProjectionAndDoesNotTrackEntities()
    {
        await using var harness = await BookingSessionReadHarness.CreateAsync();
        harness.QueryCounter.Reset();
        await using var context = harness.CreateContext();
        var service = new BookingSessionQueryService(context);

        var result = await service.GetByIdAsync(10);

        Assert.Equal(2, result.Reservations.Count);
        Assert.Equal(1, harness.QueryCounter.CompilationCount);
        Assert.Empty(context.ChangeTracker.Entries());
    }

    [Fact]
    public void Controller_ExposesOnlyAdminReadEndpoints()
    {
        var controllerType = typeof(AdminBookingSessionsController);

        Assert.Single(controllerType.GetCustomAttributes(typeof(AdminAuthorizeAttribute), inherit: true));
        Assert.Empty(controllerType.GetCustomAttributes(typeof(OwnerAuthorizeAttribute), inherit: true));
        Assert.Empty(controllerType.GetCustomAttributes(typeof(ClientAuthorizeAttribute), inherit: true));

        var endpointAttributes = controllerType
            .GetMethods()
            .Where(method => method.DeclaringType == controllerType)
            .SelectMany(method => method.GetCustomAttributes(typeof(HttpMethodAttribute), inherit: true))
            .Cast<HttpMethodAttribute>()
            .ToArray();
        Assert.Equal(2, endpointAttributes.Length);
        Assert.All(endpointAttributes, attribute => Assert.IsType<HttpGetAttribute>(attribute));
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task Controller_AllowsGlobalOrPropertyReservationPermission(
        bool globalPermission,
        bool propertyPermission)
    {
        var response = BookingSessionResponse();
        var controller = CreateController(
            new StubBookingSessionQueryService(response),
            new StubBookingSessionPermissionService(globalPermission, propertyPermission));

        var action = await controller.GetById(10, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(action.Result);
        Assert.Same(response, ok.Value);
    }

    [Fact]
    public async Task Controller_RejectsAdminWithoutReservationPermission()
    {
        var controller = CreateController(
            new StubBookingSessionQueryService(BookingSessionResponse()),
            new StubBookingSessionPermissionService(
                globalPermission: false,
                propertyPermission: false));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => controller.GetById(10, CancellationToken.None));
    }

    private static AdminBookingSessionsController CreateController(
        IBookingSessionQueryService queryService,
        IPermissionService permissionService)
    {
        var controller = new AdminBookingSessionsController(queryService, permissionService)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [
                            new Claim(ClaimTypes.NameIdentifier, "50"),
                            new Claim(ClaimTypes.Role, UserRole.AdminAssistant.ToString())
                        ],
                        "Test"))
                }
            }
        };
        return controller;
    }

    private static BookingSessionDetailsResponse BookingSessionResponse() =>
        new()
        {
            BookingSessionId = 10,
            SessionCode = "KCH-S-READ-0001",
            Property = new BookingSessionPropertyResponse
            {
                PropertyId = 1,
                Name = "Read Property",
                Slug = "read-property"
            }
        };

    private sealed class BookingSessionReadHarness : IAsyncDisposable
    {
        private readonly DbContextOptions<KoochDbContext> options;

        private BookingSessionReadHarness(
            DbContextOptions<KoochDbContext> options,
            QueryCompilationCounter queryCounter)
        {
            this.options = options;
            QueryCounter = queryCounter;
        }

        public QueryCompilationCounter QueryCounter { get; }

        public static async Task<BookingSessionReadHarness> CreateAsync()
        {
            var counter = new QueryCompilationCounter();
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"booking-session-read-{Guid.NewGuid():N}")
                .AddInterceptors(counter)
                .Options;
            var harness = new BookingSessionReadHarness(options, counter);
            await using var context = harness.CreateContext();
            context.Users.Add(new User
            {
                Id = 1,
                FirstName = "Client",
                LastName = "Reader",
                PhoneNumber = "09120000000",
                Email = "client@example.test",
                PasswordHash = "hash",
                Role = UserRole.Client,
                IsActive = true
            });
            context.Guests.Add(new Guest
            {
                Id = 1,
                UserId = 1,
                FirstName = "Guest",
                LastName = "Reader",
                Mobile = "09120000000",
                Email = "guest@example.test"
            });
            context.Properties.Add(new Property
            {
                Id = 1,
                OwnerId = 1,
                DestinationId = 1,
                Name = "Read Property",
                Slug = "read-property",
                Description = "Read projection property",
                Address = "Address",
                City = "City",
                Country = "IR",
                Status = PropertyStatus.Approved
            });
            context.RoomTypes.AddRange(
                CreateRoomType(10, "Room Type One"),
                CreateRoomType(20, "Room Type Two"));
            context.Rooms.AddRange(
                new Room { Id = 100, RoomTypeId = 10, Name = "Room One", IsActive = true },
                new Room { Id = 200, RoomTypeId = 20, Name = "Room Two", IsActive = true });

            var session = new BookingSession
            {
                Id = 10,
                SessionCode = "KCH-S-READ-0001",
                ClientId = 1,
                GuestId = 1,
                PropertyId = 1,
                Currency = "IRR",
                RequestHash = new string('A', 64)
            };
            session.Reservations.Add(CreateReservation(
                1000,
                "KCH-READ-0001",
                10,
                100,
                new DateOnly(2036, 1, 1),
                new DateOnly(2036, 1, 3),
                ReservationStatus.Confirmed,
                100));
            session.Reservations.Add(CreateReservation(
                1001,
                "KCH-READ-0002",
                20,
                200,
                new DateOnly(2036, 1, 2),
                new DateOnly(2036, 1, 5),
                ReservationStatus.PendingApproval,
                200));
            context.BookingSessions.Add(session);
            context.BookingSessions.Add(new BookingSession
            {
                Id = 11,
                SessionCode = "KCH-S-DELETED",
                ClientId = 1,
                GuestId = 1,
                PropertyId = 1,
                Currency = "IRR",
                RequestHash = new string('B', 64),
                IsDeleted = true,
                DeletedAtUtc = DateTime.UtcNow
            });
            context.Reservations.Add(CreateReservation(
                1002,
                "KCH-STANDALONE",
                10,
                roomId: null,
                new DateOnly(2036, 2, 1),
                new DateOnly(2036, 2, 2),
                ReservationStatus.Pending,
                50));
            await context.SaveChangesAsync();
            counter.Reset();
            return harness;
        }

        public KoochDbContext CreateContext() => new(options);

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private static RoomType CreateRoomType(int id, string name) =>
            new()
            {
                Id = id,
                PropertyId = 1,
                Name = name,
                Slug = $"room-type-{id}",
                Description = "Read room type",
                MaxAdults = 2,
                MaxChildren = 2,
                TotalInventory = 2,
                InventoryMode = InventoryMode.NamedRooms,
                IsActive = true
            };

        private static Reservation CreateReservation(
            int id,
            string number,
            int roomTypeId,
            int? roomId,
            DateOnly checkInDate,
            DateOnly checkOutDate,
            ReservationStatus status,
            decimal amount) =>
            new()
            {
                Id = id,
                ReservationNumber = number,
                ClientId = 1,
                GuestId = 1,
                PropertyId = 1,
                RoomTypeId = roomTypeId,
                RoomId = roomId,
                CheckInDate = checkInDate,
                CheckOutDate = checkOutDate,
                AdultCount = 1,
                TotalPrice = amount,
                BaseAmount = amount,
                FinalAmount = amount,
                Currency = "IRR",
                Status = status,
                Source = ReservationSource.Website
            };
    }

    private sealed class QueryCompilationCounter : IQueryExpressionInterceptor
    {
        private int compilationCount;

        public int CompilationCount => compilationCount;

        public Expression QueryCompilationStarting(
            Expression queryExpression,
            QueryExpressionEventData eventData)
        {
            Interlocked.Increment(ref compilationCount);
            return queryExpression;
        }

        public void Reset() => Interlocked.Exchange(ref compilationCount, 0);
    }

    private sealed class StubBookingSessionQueryService(BookingSessionDetailsResponse response)
        : IBookingSessionQueryService
    {
        public Task<PagedResult<AccountBookingSessionListItemResponse>> GetForClientAsync(
            int clientId,
            AccountBookingSessionListQuery query,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new PagedResult<AccountBookingSessionListItemResponse>());

        public Task<BookingSessionDetailsResponse> GetByIdAsync(
            int bookingSessionId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(response);

        public Task<BookingSessionDetailsResponse> GetBySessionCodeAsync(
            string sessionCode,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(response);

        public Task<AccountBookingSessionResponse> GetBySessionCodeForClientAsync(
            int clientId,
            string sessionCode,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new AccountBookingSessionResponse
            {
                SessionCode = response.SessionCode
            });
    }

    private sealed class StubBookingSessionPermissionService(
        bool globalPermission,
        bool propertyPermission) : IPermissionService
    {
        public Task<bool> CanAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(propertyPermission);

        public Task<bool> HasPermissionAsync(
            int userId,
            PermissionKey permissionKey,
            int? propertyId = null,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(globalPermission);
    }
}
