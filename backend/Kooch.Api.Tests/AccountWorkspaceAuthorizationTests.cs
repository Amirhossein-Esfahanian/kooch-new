using System.Reflection;
using System.Security.Claims;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AccountWorkspaceAuthorizationTests
{
    [Fact]
    public void PersonalReservationController_UsesAuthenticatedUserAuthorization()
    {
        var attribute = Assert.Single(
            typeof(AccountReservationsController)
                .GetCustomAttributes<AuthorizeAttribute>(inherit: true));

        Assert.Null(attribute.Policy);
        Assert.Null(attribute.Roles);
    }

    [Theory]
    [InlineData(UserRole.Client)]
    [InlineData(UserRole.SuperAdmin)]
    [InlineData(UserRole.AdminAssistant)]
    public async Task AuthenticatedActiveRole_SatisfiesAccountAuthorization(UserRole role)
    {
        var requirement = new DenyAnonymousAuthorizationRequirement();
        var principal = CreatePrincipal(1, role);
        var context = new AuthorizationHandlerContext([requirement], principal, resource: null);

        await requirement.HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public async Task UnauthenticatedPrincipal_DoesNotSatisfyAccountAuthorization()
    {
        var requirement = new DenyAnonymousAuthorizationRequirement();
        var context = new AuthorizationHandlerContext(
            [requirement],
            new ClaimsPrincipal(new ClaimsIdentity()),
            resource: null);

        await requirement.HandleAsync(context);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task InactiveUser_FailsActiveSessionValidation()
    {
        await using var dbContext = CreateContext();
        dbContext.Users.Add(CreateUser(1, UserRole.AdminAssistant, isActive: false));
        await dbContext.SaveChangesAsync();

        Assert.False(await UserSessionVersionValidator.IsValidAsync(dbContext, 1, 0));
    }

    [Fact]
    public async Task PropertyMember_UsesAuthenticatedAccountAuthorization()
    {
        var requirement = new DenyAnonymousAuthorizationRequirement();
        var context = new AuthorizationHandlerContext(
            [requirement],
            CreatePrincipal(1, UserRole.Client),
            resource: null);

        await requirement.HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public async Task ReservationDetail_DoesNotReturnAnotherUsersReservation()
    {
        await using var dbContext = CreateContext();
        var owner = CreateUser(1, UserRole.Client, isActive: true);
        var otherUser = CreateUser(2, UserRole.SuperAdmin, isActive: true);
        var propertyOwner = CreateUser(3, UserRole.Client, isActive: true);
        dbContext.Users.AddRange(owner, otherUser, propertyOwner);
        dbContext.Guests.Add(new Guest
        {
            Id = 10,
            UserId = owner.Id,
            FirstName = "Reservation",
            LastName = "Owner"
        });
        dbContext.Destinations.Add(new Destination
        {
            Id = 20,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = 30,
            OwnerId = propertyOwner.Id,
            DestinationId = 20,
            Name = "Test property",
            Slug = "test-property",
            Description = "Test property",
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
        dbContext.RoomTypes.Add(new RoomType
        {
            Id = 40,
            PropertyId = 30,
            Name = "Test room",
            Slug = "test-room",
            Description = "Test room",
            MaxAdults = 2,
            MaxChildren = 0,
            TotalInventory = 1,
            InventoryMode = InventoryMode.NamedRooms,
            IsActive = true
        });
        dbContext.Reservations.Add(new Reservation
        {
            Id = 50,
            ReservationNumber = "KCH-OWNED",
            ClientId = owner.Id,
            GuestId = 10,
            PropertyId = 30,
            RoomTypeId = 40,
            CheckInDate = new DateOnly(2026, 8, 1),
            CheckOutDate = new DateOnly(2026, 8, 2),
            AdultCount = 1,
            TotalPrice = 1_000_000,
            FinalAmount = 1_000_000,
            Currency = "IRR",
            Status = ReservationStatus.Confirmed,
            Source = ReservationSource.Website
        });
        await dbContext.SaveChangesAsync();
        var service = CreateReservationService(dbContext);

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            service.GetByNumberForGuestUserAsync(otherUser.Id, "KCH-OWNED"));
    }

    private static ReservationService CreateReservationService(KoochDbContext dbContext) => new(
        dbContext,
        null!,
        null!,
        null!,
        null!,
        null!,
        null!,
        null!,
        null!,
        null!,
        null!,
        null!);

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options);

    private static User CreateUser(int id, UserRole role, bool isActive) => new()
    {
        Id = id,
        FirstName = $"user-{id}",
        LastName = "test",
        Email = $"user-{id}@example.test",
        PasswordHash = "not-used",
        Role = role,
        IsActive = isActive
    };

    private static ClaimsPrincipal CreatePrincipal(int userId, UserRole role) =>
        new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Role, role.ToString())
            ],
            "AccountWorkspaceTests"));
}
