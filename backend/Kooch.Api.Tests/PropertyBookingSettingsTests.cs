using System.Globalization;
using System.Text.Json;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertyBookingSettingsTests
{
    [Theory]
    [InlineData("all unconfigured", null, null, null, null, null, null, true)]
    [InlineData("same-day reception", "14:00", "23:00", null, null, null, null, true)]
    [InlineData("overnight reception", "22:00", "06:00", null, null, null, null, true)]
    [InlineData("equal reception endpoints", "14:00", "14:00", null, null, null, null, false)]
    [InlineData("reception start only", "14:00", null, null, null, null, null, false)]
    [InlineData("reception end only", null, "23:00", null, null, null, null, false)]
    [InlineData("instant day zero", null, null, "23:00", 0, null, null, true)]
    [InlineData("instant next day", null, null, "02:00", 1, null, null, true)]
    [InlineData("instant time only", null, null, "23:00", null, null, null, false)]
    [InlineData("instant offset only", null, null, null, 0, null, null, false)]
    [InlineData("instant negative offset", null, null, "23:00", -1, null, null, false)]
    [InlineData("instant offset two", null, null, "23:00", 2, null, null, false)]
    [InlineData("final day zero", null, null, null, null, "23:00", 0, true)]
    [InlineData("final next day", null, null, null, null, "02:00", 1, true)]
    [InlineData("final time only", null, null, null, null, "02:00", null, false)]
    [InlineData("final offset only", null, null, null, null, null, 1, false)]
    [InlineData("final negative offset", null, null, null, null, "02:00", -1, false)]
    [InlineData("final offset two", null, null, null, null, "02:00", 2, false)]
    [InlineData("overnight cutoff", null, null, "23:00", 0, "02:00", 1, true)]
    [InlineData("same-day deadlines", null, null, "21:00", 0, "23:00", 0, true)]
    [InlineData("equal deadlines", null, null, "23:00", 0, "23:00", 0, true)]
    [InlineData("reversed deadlines", null, null, "23:00", 1, "02:00", 1, false)]
    public void Validation_EnforcesConfiguredPairsAndChronologicalDeadlines(
        string caseName,
        string? receptionFrom,
        string? receptionUntil,
        string? instantTime,
        int? instantOffset,
        string? finalTime,
        int? finalOffset,
        bool valid)
    {
        _ = caseName;
        void Validate() => PropertyBookingSettingsValidator.Validate(
            Parse(receptionFrom), Parse(receptionUntil), Parse(instantTime),
            instantOffset.HasValue ? checked((short)instantOffset.Value) : null,
            Parse(finalTime), finalOffset.HasValue ? checked((short)finalOffset.Value) : null);

        if (valid) Validate();
        else Assert.ThrowsAny<ArgumentException>(Validate);
    }

    [Fact]
    public async Task CreateAndRead_PersistExactSettingsWithoutChangingCheckInOrCheckOut()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var request = CreateRequest();
        request.CheckInTime = new TimeOnly(15, 0);
        request.CheckOutTime = new TimeOnly(11, 0);
        request.RegularReceptionFrom = new TimeOnly(22, 0);
        request.RegularReceptionUntil = new TimeOnly(6, 0);
        request.SameNightInstantBookingTime = new TimeOnly(23, 0);
        request.SameNightInstantBookingDayOffset = 0;
        request.SameNightFinalBookingTime = new TimeOnly(2, 0);
        request.SameNightFinalBookingDayOffset = 1;
        var service = CreateService(db);

        var created = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, request);
        db.ChangeTracker.Clear();
        var read = await service.GetPropertyByIdAsync(1, UserRole.SuperAdmin, created.Id);
        var stored = await db.Properties.SingleAsync();

        Assert.Equal(request.RegularReceptionFrom, read.RegularReceptionFrom);
        Assert.Equal(request.RegularReceptionUntil, read.RegularReceptionUntil);
        Assert.Equal(request.SameNightInstantBookingTime, read.SameNightInstantBookingTime);
        Assert.Equal(request.SameNightInstantBookingDayOffset, read.SameNightInstantBookingDayOffset);
        Assert.Equal(request.SameNightFinalBookingTime, read.SameNightFinalBookingTime);
        Assert.Equal(request.SameNightFinalBookingDayOffset, read.SameNightFinalBookingDayOffset);
        Assert.Equal(request.SameNightFinalBookingDayOffset, stored.SameNightFinalBookingDayOffset);
        Assert.Equal(request.CheckInTime, read.CheckInTime);
        Assert.Equal(request.CheckOutTime, read.CheckOutTime);
    }

    [Fact]
    public async Task OwnerAndAdminFullUpdates_ChangePreserveAndClearSettings()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var created = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());
        var ownerUpdate = OwnerUpdate(created.DestinationId);
        ownerUpdate.RegularReceptionFrom = new TimeOnly(14, 0);
        ownerUpdate.RegularReceptionUntil = new TimeOnly(23, 0);
        ownerUpdate.SameNightInstantBookingTime = new TimeOnly(23, 0);
        ownerUpdate.SameNightInstantBookingDayOffset = 0;
        ownerUpdate.SameNightFinalBookingTime = new TimeOnly(2, 0);
        ownerUpdate.SameNightFinalBookingDayOffset = 1;

        var changed = await service.UpdatePropertyAsync(2, UserRole.Client, created.Id, ownerUpdate);
        Assert.Equal((short)1, changed.SameNightFinalBookingDayOffset);
        ownerUpdate.Name = "Another name";
        var preserved = await service.UpdatePropertyAsync(2, UserRole.Client, created.Id, ownerUpdate);
        Assert.Equal(new TimeOnly(14, 0), preserved.RegularReceptionFrom);
        Assert.Equal((short)0, preserved.SameNightInstantBookingDayOffset);
        preserved = await service.UpdatePropertyAsync(2, UserRole.Client,
            created.Id, OwnerUpdate(created.DestinationId));
        Assert.Equal(new TimeOnly(14, 0), preserved.RegularReceptionFrom);
        Assert.Equal((short)1, preserved.SameNightFinalBookingDayOffset);

        // The existing frontend's rules-section payload has no policy fields yet.
        var section = await service.UpdateRulesSectionAsync(2, UserRole.Client, created.Id,
            new UpdatePropertyRulesSectionRequest
            {
                CheckInTime = new TimeOnly(16, 0), CheckOutTime = new TimeOnly(10, 0)
            });
        Assert.Equal(new TimeOnly(23, 0), section.SameNightInstantBookingTime);
        Assert.Equal(new TimeOnly(16, 0), section.CheckInTime);

        var adminUpdate = AdminUpdate(created.DestinationId);
        adminUpdate.RegularReceptionFrom = new TimeOnly(20, 0);
        adminUpdate.RegularReceptionUntil = new TimeOnly(6, 0);
        adminUpdate.SameNightInstantBookingTime = new TimeOnly(21, 0);
        adminUpdate.SameNightInstantBookingDayOffset = 0;
        adminUpdate.SameNightFinalBookingTime = new TimeOnly(23, 0);
        adminUpdate.SameNightFinalBookingDayOffset = 0;
        changed = await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, created.Id, adminUpdate);
        Assert.Equal(new TimeOnly(20, 0), changed.RegularReceptionFrom);
        Assert.Equal((short)0, changed.SameNightFinalBookingDayOffset);

        changed = await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin,
            created.Id, AdminUpdate(created.DestinationId));
        Assert.Equal(new TimeOnly(20, 0), changed.RegularReceptionFrom);
        var clear = AdminUpdate(created.DestinationId);
        clear.RegularReceptionFrom = null;
        clear.RegularReceptionUntil = null;
        clear.SameNightInstantBookingTime = null;
        clear.SameNightInstantBookingDayOffset = null;
        clear.SameNightFinalBookingTime = null;
        clear.SameNightFinalBookingDayOffset = null;
        changed = await service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, created.Id, clear);
        db.ChangeTracker.Clear();
        var stored = await db.Properties.SingleAsync();
        Assert.Null(changed.RegularReceptionFrom);
        Assert.Null(changed.RegularReceptionUntil);
        Assert.Null(changed.SameNightInstantBookingTime);
        Assert.Null(changed.SameNightInstantBookingDayOffset);
        Assert.Null(changed.SameNightFinalBookingTime);
        Assert.Null(changed.SameNightFinalBookingDayOffset);
        Assert.Null(stored.SameNightFinalBookingTime);
    }

    [Fact]
    public async Task UnconfiguredProperty_PersistsNullPolicyFields()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var response = await CreateService(db).CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());

        Assert.Null(response.RegularReceptionFrom);
        Assert.Null(response.RegularReceptionUntil);
        Assert.Null(response.SameNightInstantBookingTime);
        Assert.Null(response.SameNightInstantBookingDayOffset);
        Assert.Null(response.SameNightFinalBookingTime);
        Assert.Null(response.SameNightFinalBookingDayOffset);
    }

    [Fact]
    public async Task RulesSection_UpdatesAndExplicitlyClearsPolicyWithoutWipingOmittedValues()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var created = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());

        var configured = await service.UpdateRulesSectionAsync(2, UserRole.Client, created.Id,
            new UpdatePropertyRulesSectionRequest
            {
                RegularReceptionFrom = new TimeOnly(14, 0),
                RegularReceptionUntil = new TimeOnly(23, 0),
                SameNightInstantBookingTime = new TimeOnly(23, 0),
                SameNightInstantBookingDayOffset = 0,
                SameNightFinalBookingTime = new TimeOnly(2, 0),
                SameNightFinalBookingDayOffset = 1
            });
        Assert.Equal((short)1, configured.SameNightFinalBookingDayOffset);

        var oldPayload = JsonSerializer.Deserialize<UpdatePropertyRulesSectionRequest>(
            "{\"checkInTime\":\"15:00:00\"}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var preserved = await service.UpdateRulesSectionAsync(2, UserRole.Client, created.Id, oldPayload);
        Assert.Equal(new TimeOnly(14, 0), preserved.RegularReceptionFrom);
        Assert.Equal((short)1, preserved.SameNightFinalBookingDayOffset);

        var cleared = await service.UpdateRulesSectionAsync(1, UserRole.SuperAdmin, created.Id,
            new AdminUpdatePropertyRulesSectionRequest
            {
                RegularReceptionFrom = null,
                RegularReceptionUntil = null,
                SameNightInstantBookingTime = null,
                SameNightInstantBookingDayOffset = null,
                SameNightFinalBookingTime = null,
                SameNightFinalBookingDayOffset = null
            });
        Assert.Null(cleared.RegularReceptionFrom);
        Assert.Null(cleared.SameNightInstantBookingDayOffset);
        Assert.Null(cleared.SameNightFinalBookingDayOffset);
    }

    [Fact]
    public async Task RulesSection_RejectsInvalidPartialPolicyWithoutSaving()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var created = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());
        var request = new UpdatePropertyRulesSectionRequest
        {
            RegularReceptionFrom = new TimeOnly(14, 0)
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdateRulesSectionAsync(2, UserRole.Client, created.Id, request));
        Assert.Null((await db.Properties.SingleAsync()).RegularReceptionFrom);
    }

    [Fact]
    public async Task InvalidCreateAndUpdates_RejectBeforeSaving()
    {
        await using var db = CreateContext();
        await SeedAsync(db);
        var service = CreateService(db);
        var invalidCreate = CreateRequest();
        invalidCreate.RegularReceptionFrom = new TimeOnly(14, 0);
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreatePropertyAsync(1, UserRole.SuperAdmin, invalidCreate));
        Assert.Empty(db.Properties);

        var created = await service.CreatePropertyAsync(1, UserRole.SuperAdmin, CreateRequest());
        var invalidOwner = OwnerUpdate(created.DestinationId);
        invalidOwner.SameNightInstantBookingTime = new TimeOnly(23, 0);
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdatePropertyAsync(2, UserRole.Client, created.Id, invalidOwner));
        var invalidAdmin = AdminUpdate(created.DestinationId);
        invalidAdmin.SameNightFinalBookingDayOffset = 1;
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.UpdatePropertyForAdminAsync(1, UserRole.SuperAdmin, created.Id, invalidAdmin));
        Assert.Null((await db.Properties.SingleAsync()).SameNightFinalBookingDayOffset);
    }

    [Fact]
    public void Model_UsesNullableTimeAndSmallintColumns()
    {
        using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlServer("Server=.;Database=ModelInspectionOnly;Trusted_Connection=True;").Options);
        var property = db.Model.FindEntityType(typeof(Property))!;
        foreach (var name in new[]
                 {
                     nameof(Property.RegularReceptionFrom), nameof(Property.RegularReceptionUntil),
                     nameof(Property.SameNightInstantBookingTime), nameof(Property.SameNightFinalBookingTime)
                 })
        {
            Assert.True(property.FindProperty(name)!.IsNullable);
            Assert.Equal("time", property.FindProperty(name)!.GetColumnType());
        }
        foreach (var name in new[]
                 {
                     nameof(Property.SameNightInstantBookingDayOffset),
                     nameof(Property.SameNightFinalBookingDayOffset)
                 })
        {
            Assert.True(property.FindProperty(name)!.IsNullable);
            Assert.Equal("smallint", property.FindProperty(name)!.GetColumnType());
        }
    }

    private static TimeOnly? Parse(string? value) => value is null
        ? null : TimeOnly.ParseExact(value, "HH:mm", CultureInfo.InvariantCulture);

    private static KoochDbContext CreateContext() => new(
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);

    private static PropertyService CreateService(KoochDbContext db)
    {
        var access = new PropertyAccessService(db);
        return new PropertyService(db, access, access, new PermissionService(db, access), null!, null!);
    }

    private static async Task SeedAsync(KoochDbContext db)
    {
        db.Users.AddRange(
            new User { Id = 1, FirstName = "Admin", LastName = "User", Email = "admin@example.test", PasswordHash = "hash", Role = UserRole.SuperAdmin, IsActive = true },
            new User { Id = 2, FirstName = "Owner", LastName = "User", Email = "owner@example.test", PasswordHash = "hash", Role = UserRole.Client, IsActive = true });
        db.Destinations.Add(new Destination { Id = 10, Name = "Kashan", Slug = "kashan", Country = "IR" });
        await db.SaveChangesAsync();
    }

    private static CreatePropertyRequest CreateRequest() => new()
    {
        OwnerId = 2, DestinationId = 10, Name = "Property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse
    };

    private static UpdatePropertyRequest OwnerUpdate(int destinationId) => new()
    {
        DestinationId = destinationId, Name = "Property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse
    };

    private static AdminUpdatePropertyRequest AdminUpdate(int destinationId) => new()
    {
        OwnerId = 2, DestinationId = destinationId, Name = "Property", Description = "Description",
        Address = "Address", City = "Kashan", Country = "IR", Type = PropertyType.TraditionalHouse,
        Status = PropertyStatus.Draft
    };
}
