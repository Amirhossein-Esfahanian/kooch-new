using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationVoucherProjectionTests
{
    [Fact]
    public async Task StandardVoucherProjection_HasNoExplicitRatePlan()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();

        var guest = await harness.Service.GetForGuestAsync(1, "R-583214");
        var owner = await harness.Service.GetForPropertyAsync(3, 10, 40);
        var admin = await harness.Service.GetForAdminAsync(40);

        Assert.False(guest.HasExplicitRatePlan);
        Assert.Null(guest.RatePlanName);
        Assert.Null(guest.MealPlanName);
        Assert.False(owner.HasExplicitRatePlan);
        Assert.False(admin.HasExplicitRatePlan);
    }

    [Fact]
    public async Task ExplicitRatePlanProjection_UsesReservationSnapshotAfterPlanChanges()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync(withRatePlan: true);
        var plan = await harness.Context.RatePlans.SingleAsync();
        plan.Name = "Renamed current plan";
        plan.IsActive = false;
        plan.IsDeleted = true;
        await harness.Context.SaveChangesAsync();
        harness.Context.ChangeTracker.Clear();

        var guest = await harness.Service.GetForGuestAsync(1, "R-583214");
        var owner = await harness.Service.GetForPropertyAsync(3, 10, 40);
        var admin = await harness.Service.GetForAdminAsync(40);

        Assert.True(guest.HasExplicitRatePlan);
        Assert.Equal("Without breakfast", guest.RatePlanName);
        Assert.Equal("Room only", guest.MealPlanName);
        Assert.Equal(guest.RatePlanName, owner.RatePlanName);
        Assert.Equal(guest.RatePlanName, admin.RatePlanName);
        Assert.Equal(guest.MealPlanName, owner.MealPlanName);
        Assert.Equal(guest.MealPlanName, admin.MealPlanName);
        var json = JsonSerializer.Serialize(guest, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("ratePlanId", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("modifier", json, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(harness.Context.ChangeTracker.Entries());
    }

    [Fact]
    public async Task ExplicitRatePlanWithoutSnapshot_DoesNotProjectMutablePlanName()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync(
            withRatePlan: true, ratePlanSnapshotName: null);

        var guest = await harness.Service.GetForGuestAsync(1, "R-583214");

        Assert.True(guest.HasExplicitRatePlan);
        Assert.Null(guest.RatePlanName);
        Assert.NotEqual("Current plan", guest.RatePlanName);
    }

    [Theory]
    [InlineData(UserRole.SuperAdmin, false, true)]
    [InlineData(UserRole.AdminAssistant, true, true)]
    [InlineData(UserRole.AdminAssistant, false, false)]
    public async Task AdminFinancialPermission_IsPlatformScoped(UserRole role, bool allowed, bool expected)
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        harness.Context.Users.Add(new User { Id = 90, Role = role, IsActive = true });
        if (allowed) harness.Context.UserPermissions.Add(new UserPermission
        {
            UserId = 90, PermissionKey = PermissionKey.ManagePayments, IsAllowed = true
        });
        await harness.Context.SaveChangesAsync();
        var requirement = new PermissionRequirement(PermissionKey.ManagePayments);
        var authorization = new AuthorizationHandlerContext([requirement],
            ControllerContext(90, role).HttpContext.User, new DefaultHttpContext());
        await new PermissionAuthorizationHandler(new PermissionService(harness.Context,
            new PropertyAccessService(harness.Context))).HandleAsync(authorization);
        Assert.Equal(expected, authorization.HasSucceeded);
        if (expected)
        {
            var controller = new AdminReservationVouchersController(harness.Service);
            Assert.IsType<OkObjectResult>((await controller.Get(40, CancellationToken.None)).Result);
        }
    }

    [Fact]
    public async Task AdminProjection_ReusesPersistedOwnerSnapshotWithoutWrites()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        harness.Property.ShowGuestPhoneToPropertyUsers = true;
        harness.Reservation.FinalAmount = 1m;
        await harness.Context.SaveChangesAsync();
        var expected = await harness.Service.GetForPropertyAsync(3, 10, 40);
        harness.Context.ChangeTracker.Clear();
        var controller = new AdminReservationVouchersController(harness.Service);
        var action = await controller.Get(40, CancellationToken.None);
        var actual = Assert.IsType<OwnerReservationVoucherResponse>(Assert.IsType<OkObjectResult>(action.Result).Value);
        Assert.Equal(JsonSerializer.Serialize(expected), JsonSerializer.Serialize(actual));
        Assert.Equal(750m, actual.GrossAmount);
        Assert.Empty(harness.Context.ChangeTracker.Entries());
        var count = await harness.Context.ReservationVouchers.CountAsync();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => controller.Get(41, CancellationToken.None));
        Assert.Equal(count, await harness.Context.ReservationVouchers.CountAsync());
        Assert.Empty(harness.Context.ChangeTracker.Entries());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PropertyPhoneVisibility_UsesSnapshotWithoutChangingVoucher(bool showPhone)
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        var original = JsonSerializer.Serialize(await harness.Context.ReservationVouchers.AsNoTracking().SingleAsync());
        harness.Property.ShowGuestPhoneToPropertyUsers = showPhone;
        harness.Guest.Mobile = "09121111111";
        await harness.Context.SaveChangesAsync();
        harness.Context.ChangeTracker.Clear();

        var owner = await harness.Service.GetForPropertyAsync(3, 10, 40);
        var admin = await harness.Service.GetForAdminAsync(40);
        Assert.Equal(showPhone ? "09129999999" : null, owner.GuestMobile);
        Assert.Equal("09129999999", admin.GuestMobile);
        var json = JsonSerializer.Serialize(owner, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(showPhone, json.Contains("guestMobile"));
        Assert.Empty(harness.Context.ChangeTracker.Entries());
        Assert.Equal(original, JsonSerializer.Serialize(await harness.Context.ReservationVouchers.AsNoTracking().SingleAsync()));
    }

    [Fact]
    public async Task ChangingPhoneVisibility_AffectsExistingOwnerProjectionOnly()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        Assert.Null((await harness.Service.GetForPropertyAsync(3, 10, 40)).GuestMobile);
        harness.Property.ShowGuestPhoneToPropertyUsers = true;
        await harness.Context.SaveChangesAsync();
        Assert.Equal("09129999999", (await harness.Service.GetForPropertyAsync(3, 10, 40)).GuestMobile);
        harness.Property.ShowGuestPhoneToPropertyUsers = false;
        await harness.Context.SaveChangesAsync();
        Assert.Null((await harness.Service.GetForPropertyAsync(3, 10, 40)).GuestMobile);
        Assert.Single(await harness.Context.ReservationVouchers.ToListAsync());
        Assert.Equal("09129999999", (await harness.Context.ReservationVouchers.SingleAsync()).GuestMobileSnapshot);
    }

    [Fact]
    public void AdminVoucherEndpoint_UsesExistingAdminPaymentPolicyAndGetOnly()
    {
        var type = typeof(AdminReservationVouchersController);
        Assert.Single(type.GetCustomAttributes(typeof(AdminAuthorizeAttribute), true));
        var permission = Assert.Single(type.GetCustomAttributes(typeof(PermissionAuthorizeAttribute), true)
            .Cast<PermissionAuthorizeAttribute>());
        Assert.Equal(new PermissionAuthorizeAttribute(PermissionKey.ManagePayments).Policy, permission.Policy);
        Assert.Empty(type.GetCustomAttributes(typeof(OwnerAuthorizeAttribute), true));
        Assert.Equal("api/admin/reservations/{reservationId:int}/voucher",
            Assert.Single(type.GetCustomAttributes(typeof(RouteAttribute), true).Cast<RouteAttribute>()).Template);
        Assert.IsType<HttpGetAttribute>(Assert.Single(type.GetMethod("Get")!
            .GetCustomAttributes(typeof(HttpMethodAttribute), true)));
    }

    [Fact]
    public async Task GuestOwner_CanRetrieveVoucherThroughAccountController()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        var controller = new AccountReservationVouchersController(harness.Service)
        {
            ControllerContext = ControllerContext(1, UserRole.Client)
        };

        var action = await controller.Get("R-583214", CancellationToken.None);

        var response = Assert.IsType<GuestReservationVoucherResponse>(
            Assert.IsType<OkObjectResult>(action.Result).Value);
        Assert.Equal("V-271946", response.VoucherNumber);
        Assert.Equal(750m, response.GrossAmount);
        Assert.Equal("IRR", response.Currency);
    }

    [Fact]
    public async Task GuestProjection_RejectsAnotherGuestAndContainsNoFinancialInternalFields()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetForGuestAsync(2, "R-583214"));

        var response = await harness.Service.GetForGuestAsync(1, "R-583214");
        var json = JsonSerializer.Serialize(
            response,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.DoesNotContain("commissionRate", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("commissionAmount", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("propertyPayableAmount", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("paymentId", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("snapshotId", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("guestMobile", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("guestEmail", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GuestProjection_UsesPersistedVoucherSnapshotAfterSourcesChange()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        harness.Property.Name = "Current property";
        harness.Guest.FirstName = "Current";
        harness.Guest.LastName = "guest";
        harness.RoomType.Name = "Current room type";
        harness.Reservation.ReservationNumber = "R-CHANGED";
        harness.Reservation.FinalAmount = 9999m;
        await harness.Context.SaveChangesAsync();

        var response = await harness.Service.GetForGuestAsync(1, "R-CHANGED");

        Assert.Equal("R-583214", response.ReservationNumber);
        Assert.Equal("Historical property", response.PropertyName);
        Assert.Equal("Historical guest", response.GuestName);
        Assert.Equal("Historical room type", response.RoomTypeName);
        Assert.Equal(750m, response.GrossAmount);
    }

    [Fact]
    public async Task MissingOrCapacityLostVoucher_ReturnsNotFoundWithoutIssuance()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        var before = await harness.Context.ReservationVouchers.CountAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetForGuestAsync(1, "R-NO-VOUCHER"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetForPropertyAsync(3, 10, 41));

        Assert.Equal(before, await harness.Context.ReservationVouchers.CountAsync());
        Assert.Equal(
            ReservationStatus.CapacityLost,
            (await harness.Context.Reservations.FindAsync(41))!.Status);
    }

    [Fact]
    public async Task AuthorizedPropertyOwner_CanRetrieveFinancialVoucherThroughOwnerController()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        var controller = new OwnerReservationVouchersController(harness.Service)
        {
            ControllerContext = ControllerContext(3, UserRole.Client)
        };

        var action = await controller.Get(10, 40, CancellationToken.None);

        var response = Assert.IsType<OwnerReservationVoucherResponse>(
            Assert.IsType<OkObjectResult>(action.Result).Value);
        Assert.Equal(750m, response.GrossAmount);
        Assert.Equal(12.5m, response.CommissionRate);
        Assert.Equal(93.75m, response.CommissionAmount);
        Assert.Equal(656.25m, response.PropertyPayableAmount);
    }

    [Fact]
    public async Task OwnerProjection_RequiresFinancialViewAndRejectsCrossPropertyLookup()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            harness.Service.GetForPropertyAsync(4, 10, 40));
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            harness.Service.GetForPropertyAsync(3, 11, 40));
    }

    [Fact]
    public async Task OwnerProjection_UsesVoucherFinancialSnapshotNotCurrentMutableValues()
    {
        await using var harness = await VoucherProjectionHarness.CreateAsync();
        harness.Reservation.FinalAmount = 1m;
        harness.Context.SiteSettings.Add(new SiteSetting
        {
            Key = CommissionPolicyResolver.DirectSettingKey,
            Value = "99",
            Type = SiteSettingType.Number,
            Group = "Reservation",
            Label = "Changed commission",
            IsActive = true
        });
        await harness.Context.SaveChangesAsync();

        var response = await harness.Service.GetForPropertyAsync(3, 10, 40);

        Assert.Equal(750m, response.GrossAmount);
        Assert.Equal(12.5m, response.CommissionRate);
        Assert.Equal(93.75m, response.CommissionAmount);
        Assert.Equal(656.25m, response.PropertyPayableAmount);
    }

    [Fact]
    public async Task ProjectionEndpoints_AreParentScopedGetOnlyAndQueriesAreReadOnly()
    {
        Assert.Equal(
            "api/account/reservations/{reservationNumber}/voucher",
            Assert.Single(typeof(AccountReservationVouchersController)
                .GetCustomAttributes(typeof(RouteAttribute), inherit: true)
                .Cast<RouteAttribute>()).Template);
        var accountAuthorization = Assert.Single(
            typeof(AccountReservationVouchersController)
                .GetCustomAttributes(typeof(AuthorizeAttribute), inherit: true)
                .Cast<AuthorizeAttribute>());
        Assert.Null(accountAuthorization.Policy);
        Assert.Equal(
            "api/owner/properties/{propertyId:int}/reservations/{reservationId:int}/voucher",
            Assert.Single(typeof(OwnerReservationVouchersController)
                .GetCustomAttributes(typeof(RouteAttribute), inherit: true)
                .Cast<RouteAttribute>()).Template);
        Assert.Single(
            typeof(OwnerReservationVouchersController)
                .GetCustomAttributes(typeof(OwnerAuthorizeAttribute), inherit: true));
        Assert.IsType<HttpGetAttribute>(Assert.Single(
            typeof(AccountReservationVouchersController).GetMethod(nameof(AccountReservationVouchersController.Get))!
                .GetCustomAttributes(typeof(HttpMethodAttribute), inherit: true)));
        Assert.IsType<HttpGetAttribute>(Assert.Single(
            typeof(OwnerReservationVouchersController).GetMethod(nameof(OwnerReservationVouchersController.Get))!
                .GetCustomAttributes(typeof(HttpMethodAttribute), inherit: true)));

        await using var harness = await VoucherProjectionHarness.CreateAsync();
        harness.Context.ChangeTracker.Clear();
        await harness.Service.GetForGuestAsync(1, "R-583214");
        await harness.Service.GetForPropertyAsync(3, 10, 40);

        Assert.DoesNotContain(
            harness.Context.ChangeTracker.Entries(),
            entry => entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted);
        Assert.Equal(1, await harness.Context.ReservationVouchers.CountAsync());
    }

    private static ControllerContext ControllerContext(int userId, UserRole role)
    {
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Role, role.ToString())
            ],
            authenticationType: "test");
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(identity)
            }
        };
    }

    private sealed class VoucherProjectionHarness : IAsyncDisposable
    {
        private VoucherProjectionHarness(
            KoochDbContext context,
            Property property,
            Guest guest,
            RoomType roomType,
            Reservation reservation)
        {
            Context = context;
            Property = property;
            Guest = guest;
            RoomType = roomType;
            Reservation = reservation;
            Service = new ReservationVoucherQueryService(
                context,
                new PermissionService(context, new PropertyAccessService(context)));
        }

        public KoochDbContext Context { get; }
        public Property Property { get; }
        public Guest Guest { get; }
        public RoomType RoomType { get; }
        public Reservation Reservation { get; }
        public ReservationVoucherQueryService Service { get; }

        public static async Task<VoucherProjectionHarness> CreateAsync(
            bool withRatePlan = false,
            string? ratePlanSnapshotName = "Without breakfast")
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"voucher-projection-{Guid.NewGuid():N}")
                .Options;
            var context = new KoochDbContext(options);
            var guestUser = User(1, "Guest", "Owner");
            var otherGuestUser = User(2, "Other", "Guest");
            var propertyOwner = User(3, "Property", "Owner");
            var unauthorizedUser = User(4, "Unauthorized", "Staff");
            var guest = new Guest
            {
                Id = 20,
                UserId = guestUser.Id,
                FirstName = "Current",
                LastName = "Guest",
                Mobile = "09120000000",
                Email = "current@example.test"
            };
            var property = CreateProperty(10, propertyOwner.Id, "Current property");
            var otherProperty = CreateProperty(11, propertyOwner.Id, "Other property");
            var roomType = new RoomType
            {
                Id = 30,
                PropertyId = property.Id,
                Name = "Current room type",
                Slug = "current-room-type",
                TotalInventory = 1,
                InventoryMode = InventoryMode.TypeBasedInventory
            };
            var reservation = CreateReservation(40, "R-583214", ReservationStatus.Confirmed);
            if (withRatePlan)
            {
                reservation.RatePlanId = 99;
                reservation.RatePlanNameSnapshot = ratePlanSnapshotName;
                reservation.MealPlanNameSnapshot = "Room only";
                reservation.MealPlanSlugSnapshot = "room-only";
                reservation.RatePlanPriceModifierTypeSnapshot = PriceModifierType.FixedAmount;
                reservation.RatePlanPriceModifierValueSnapshot = -100m;
            }
            var capacityLost = CreateReservation(41, "R-NO-VOUCHER", ReservationStatus.CapacityLost);
            var payment = new Payment
            {
                Id = 50,
                ReservationId = reservation.Id,
                Amount = 750m,
                Currency = "IRR",
                Status = PaymentStatus.Successful
            };
            var snapshot = new ReservationFinancialSnapshot
            {
                Id = 60,
                ReservationId = reservation.Id,
                PropertyId = property.Id,
                PaymentId = payment.Id,
                GrossAmount = 750m,
                Currency = "IRR",
                CommissionType = CommissionType.Direct,
                CommissionRateSource = CommissionRateSource.Global,
                CommissionRate = 12.5m,
                CommissionBase = 750m,
                CommissionAmount = 93.75m,
                PropertyPayableAmount = 656.25m,
                CalculatedAtUtc = DateTime.UtcNow
            };
            var voucher = new ReservationVoucher
            {
                Id = 70,
                ReservationId = reservation.Id,
                ReservationFinancialSnapshotId = snapshot.Id,
                PropertyId = property.Id,
                VoucherNumber = "V-271946",
                IssuedAtUtc = new DateTime(2036, 1, 5, 10, 0, 0, DateTimeKind.Utc),
                ReservationNumberSnapshot = "R-583214",
                PropertyNameSnapshot = "Historical property",
                GuestNameSnapshot = "Historical guest",
                GuestMobileSnapshot = "09129999999",
                GuestEmailSnapshot = "historical@example.test",
                RoomTypeNameSnapshot = "Historical room type",
                RoomNameSnapshot = "Historical room",
                CheckInSnapshot = new DateOnly(2036, 1, 1),
                CheckOutSnapshot = new DateOnly(2036, 1, 4),
                NightsSnapshot = 3,
                AdultCountSnapshot = 2,
                ChildCountSnapshot = 1,
                GrossAmount = 750m,
                Currency = "IRR",
                CommissionRate = 12.5m,
                CommissionAmount = 93.75m,
                PropertyPayableAmount = 656.25m
            };
            context.AddRange(
                guestUser,
                otherGuestUser,
                propertyOwner,
                unauthorizedUser,
                guest,
                property,
                otherProperty,
                roomType,
                reservation,
                capacityLost,
                payment,
                snapshot,
                voucher,
                Membership(80, propertyOwner.Id, property.Id),
                Membership(81, propertyOwner.Id, otherProperty.Id));
            if (withRatePlan)
            {
                context.RatePlans.Add(new RatePlan
                {
                    Id = 99,
                    RoomTypeId = roomType.Id,
                    Name = "Current plan",
                    PriceModifierType = PriceModifierType.FixedAmount,
                    PriceModifierValue = -100m
                });
            }
            await context.SaveChangesAsync();
            return new VoucherProjectionHarness(context, property, guest, roomType, reservation);
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();

        private static User User(int id, string firstName, string lastName) => new()
        {
            Id = id,
            FirstName = firstName,
            LastName = lastName,
            Email = $"user-{id}@example.test",
            PasswordHash = "not-used",
            Role = UserRole.Client,
            IsActive = true
        };

        private static Property CreateProperty(int id, int ownerId, string name) => new()
        {
            Id = id,
            OwnerId = ownerId,
            Name = name,
            Slug = $"property-{id}",
            Status = PropertyStatus.Approved
        };

        private static Reservation CreateReservation(int id, string number, ReservationStatus status) => new()
        {
            Id = id,
            ReservationNumber = number,
            ClientId = 1,
            GuestId = 20,
            PropertyId = 10,
            RoomTypeId = 30,
            CheckInDate = new DateOnly(2036, 1, 1),
            CheckOutDate = new DateOnly(2036, 1, 4),
            AdultCount = 2,
            ChildCount = 1,
            FinalAmount = 750m,
            Currency = "IRR",
            Status = status,
            Source = ReservationSource.Website
        };

        private static UserPropertyAccess Membership(int id, int userId, int propertyId) => new()
        {
            Id = id,
            UserId = userId,
            PropertyId = propertyId,
            PropertyRole = PropertyUserRole.PropertyOwner,
            Status = PropertyUserStatus.Active,
            IsActive = true,
            PermissionMatrixJson = JsonSerializer.Serialize(new PermissionMatrixDto
            {
                ["Financial"] = new PermissionActionsDto { View = true }
            })
        };
    }
}
