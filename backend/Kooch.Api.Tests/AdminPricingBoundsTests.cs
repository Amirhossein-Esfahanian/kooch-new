using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.SiteSettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminPricingBoundsTests
{
    private const int SuperAdminId = 1;
    private const int AdminAssistantId = 2;

    [Fact]
    public async Task Get_ReturnsTheStoredPairIncludingDecimalsAndInactiveRows()
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, "100.25", "1000.75", isActive: false);
        await dbContext.SaveChangesAsync();

        var result = await new PricingBoundsService(dbContext).GetAsync();

        Assert.Equal(100.25m, result.MinPrice);
        Assert.Equal(1000.75m, result.MaxPrice);
    }

    [Fact]
    public async Task Get_WhenEitherRowIsMissing_RejectsWithoutDefaulting()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.Add(Setting(PricingBoundsService.MinimumPriceKey, "100"));
        await dbContext.SaveChangesAsync();

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            new PricingBoundsService(dbContext).GetAsync());
    }

    [Theory]
    [InlineData(PricingBoundsService.MinimumPriceKey)]
    [InlineData(PricingBoundsService.MaximumPriceKey)]
    public async Task Get_WhenStoredValueIsMalformed_RejectsClearly(string malformedKey)
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, "100", "1000");
        dbContext.SiteSettings.Local.Single(setting => setting.Key == malformedKey).Value = "not-a-price";
        await dbContext.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new PricingBoundsService(dbContext).GetAsync());

        Assert.Contains(malformedKey, error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("100", "1000", "1500", "3000")]
    [InlineData("1500", "3000", "100", "1000")]
    [InlineData("100", "1000", "125.50", "975.75")]
    public async Task Update_ValidCompletePair_PersistsBothValuesTogether(
        string currentMinimum,
        string currentMaximum,
        string targetMinimum,
        string targetMaximum)
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, currentMinimum, currentMaximum);
        await dbContext.SaveChangesAsync();
        var service = new PricingBoundsService(dbContext);

        var updated = await service.UpdateAsync(new UpdatePricingBoundsRequest(
            decimal.Parse(targetMinimum, System.Globalization.CultureInfo.InvariantCulture),
            decimal.Parse(targetMaximum, System.Globalization.CultureInfo.InvariantCulture)));
        dbContext.ChangeTracker.Clear();
        var read = await service.GetAsync();

        Assert.Equal(updated, read);
        Assert.Equal(decimal.Parse(targetMinimum, System.Globalization.CultureInfo.InvariantCulture), read.MinPrice);
        Assert.Equal(decimal.Parse(targetMaximum, System.Globalization.CultureInfo.InvariantCulture), read.MaxPrice);
    }

    public static TheoryData<decimal?, decimal?> InvalidPairs => new()
    {
        { -1m, 100m },
        { 0m, -1m },
        { 900m, 500m },
        { null, 100m },
        { 0m, null }
    };

    [Theory]
    [MemberData(nameof(InvalidPairs))]
    public async Task Update_InvalidPair_ChangesNeitherPersistedValue(decimal? minimum, decimal? maximum)
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, "100", "1000");
        await dbContext.SaveChangesAsync();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            new PricingBoundsService(dbContext).UpdateAsync(
                new UpdatePricingBoundsRequest(minimum, maximum)));

        await AssertPersistedValuesAsync(dbContext, "100", "1000");
    }

    [Fact]
    public void RequestContract_RequiresBothValuesAndInvalidDecimalJsonCannotBind()
    {
        var properties = typeof(UpdatePricingBoundsRequest).GetProperties();
        Assert.All(properties, property => Assert.NotNull(property.GetCustomAttribute<RequiredAttribute>()));

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<UpdatePricingBoundsRequest>(
            "{\"minPrice\":\"invalid\",\"maxPrice\":1000}",
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }));
    }

    [Fact]
    public async Task Update_SaveFailure_LeavesBothPersistedValuesUnchanged()
    {
        var options = CreateOptions($"pricing-bounds-failure-{Guid.NewGuid():N}");
        await using var dbContext = new FailingKoochDbContext(options);
        AddBounds(dbContext, "100", "1000");
        await dbContext.SaveChangesAsync();
        dbContext.FailNextSave();

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            new PricingBoundsService(dbContext).UpdateAsync(
                new UpdatePricingBoundsRequest(1500m, 3000m)));

        await AssertPersistedValuesAsync(dbContext, "100", "1000");
    }

    [Fact]
    public async Task Update_UsesOneSaveWithBothPricingRowsModified()
    {
        var options = CreateOptions($"pricing-bounds-count-{Guid.NewGuid():N}");
        await using var dbContext = new RecordingKoochDbContext(options);
        AddBounds(dbContext, "100", "1000");
        await dbContext.SaveChangesAsync();
        dbContext.ResetRecording();

        await new PricingBoundsService(dbContext).UpdateAsync(
            new UpdatePricingBoundsRequest(1500m, 3000m));

        Assert.Equal(1, dbContext.SaveCallCount);
        Assert.Equal(2, dbContext.ModifiedPricingRowsAtSave);
    }

    [Fact]
    public async Task Controller_SuperAdminCanGetAndUpdate()
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, "100", "1000");
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, new PermissionStub(false), SuperAdminId, UserRole.SuperAdmin);

        var get = GetValue(await controller.Get(CancellationToken.None));
        var updated = GetValue(await controller.Update(
            new UpdatePricingBoundsRequest(1500m, 3000m),
            CancellationToken.None));

        Assert.Equal(new PricingBoundsResponse(100m, 1000m), get);
        Assert.Equal(new PricingBoundsResponse(1500m, 3000m), updated);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Controller_AdminAssistantRequiresManageSettings(bool allowed)
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, "100", "1000");
        await dbContext.SaveChangesAsync();
        var controller = CreateController(
            dbContext,
            new PermissionStub(allowed),
            AdminAssistantId,
            UserRole.AdminAssistant);

        if (allowed)
        {
            Assert.Equal(
                new PricingBoundsResponse(100m, 1000m),
                GetValue(await controller.Get(CancellationToken.None)));
            return;
        }

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            controller.Get(CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            controller.Update(new UpdatePricingBoundsRequest(200m, 2000m), CancellationToken.None));
        await AssertPersistedValuesAsync(dbContext, "100", "1000");
    }

    [Fact]
    public async Task GenericAdminEndpoints_StillExposeAndUpdatePricingBoundsTemporarily()
    {
        await using var dbContext = CreateContext();
        AddBounds(dbContext, "100", "1000");
        await dbContext.SaveChangesAsync();
        var controller = new AdminSiteSettingsController(
            dbContext,
            new PermissionStub(false),
            uploadService: null!);
        SetCurrentUser(controller, SuperAdminId, UserRole.SuperAdmin);

        var getResponse = await controller.Get(CancellationToken.None);
        var settings = Assert.IsAssignableFrom<IReadOnlyList<SiteSettingResponse>>(
            Assert.IsType<OkObjectResult>(getResponse.Result).Value);
        await controller.Update(
            PricingBoundsService.MinimumPriceKey,
            new UpdateSiteSettingRequest("200"),
            CancellationToken.None);

        Assert.Contains(settings, setting => setting.Key == PricingBoundsService.MinimumPriceKey);
        Assert.Contains(settings, setting => setting.Key == PricingBoundsService.MaximumPriceKey);
        Assert.Equal("200", dbContext.SiteSettings.Single(
            setting => setting.Key == PricingBoundsService.MinimumPriceKey).Value);
    }

    private static AdminPricingBoundsController CreateController(
        KoochDbContext dbContext,
        IPermissionService permissionService,
        int userId,
        UserRole role)
    {
        var controller = new AdminPricingBoundsController(
            new PricingBoundsService(dbContext),
            permissionService);
        SetCurrentUser(controller, userId, role);
        return controller;
    }

    private static void SetCurrentUser(ControllerBase controller, int userId, UserRole role)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim(ClaimTypes.Role, role.ToString())
                    ],
                    nameof(AdminPricingBoundsTests)))
            }
        };
    }

    private static PricingBoundsResponse GetValue(ActionResult<PricingBoundsResponse> response) =>
        Assert.IsType<PricingBoundsResponse>(Assert.IsType<OkObjectResult>(response.Result).Value);

    private static void AddBounds(
        KoochDbContext dbContext,
        string minimum,
        string maximum,
        bool isActive = true)
    {
        dbContext.SiteSettings.AddRange(
            Setting(PricingBoundsService.MinimumPriceKey, minimum, isActive),
            Setting(PricingBoundsService.MaximumPriceKey, maximum, isActive));
    }

    private static SiteSetting Setting(string key, string value, bool isActive = true) => new()
    {
        Key = key,
        Value = value,
        Type = SiteSettingType.Number,
        Group = "Pricing",
        Label = key,
        IsActive = isActive
    };

    private static async Task AssertPersistedValuesAsync(
        KoochDbContext dbContext,
        string expectedMinimum,
        string expectedMaximum)
    {
        dbContext.ChangeTracker.Clear();
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting =>
                setting.Key == PricingBoundsService.MinimumPriceKey ||
                setting.Key == PricingBoundsService.MaximumPriceKey)
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);
        Assert.Equal(expectedMinimum, values[PricingBoundsService.MinimumPriceKey]);
        Assert.Equal(expectedMaximum, values[PricingBoundsService.MaximumPriceKey]);
    }

    private static KoochDbContext CreateContext() => new(CreateOptions(
        $"admin-pricing-bounds-{Guid.NewGuid():N}"));

    private static DbContextOptions<KoochDbContext> CreateOptions(string databaseName) =>
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(databaseName)
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private sealed class PermissionStub(bool allowed) : IPermissionService
    {
        public Task<bool> CanAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(allowed);

        public Task<bool> HasPermissionAsync(
            int userId,
            PermissionKey permissionKey,
            int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(allowed);
    }

    private sealed class FailingKoochDbContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        private bool failNextSave;

        public void FailNextSave() => failNextSave = true;

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            if (failNextSave)
            {
                failNextSave = false;
                throw new DbUpdateException("Simulated pricing bounds persistence failure.");
            }

            return base.SaveChangesAsync(cancellationToken);
        }
    }

    private sealed class RecordingKoochDbContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        public int SaveCallCount { get; private set; }
        public int ModifiedPricingRowsAtSave { get; private set; }

        public void ResetRecording()
        {
            SaveCallCount = 0;
            ModifiedPricingRowsAtSave = 0;
        }

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            SaveCallCount++;
            ModifiedPricingRowsAtSave = ChangeTracker.Entries<SiteSetting>().Count(entry =>
                entry.State == EntityState.Modified &&
                (entry.Entity.Key == PricingBoundsService.MinimumPriceKey ||
                 entry.Entity.Key == PricingBoundsService.MaximumPriceKey));
            return base.SaveChangesAsync(cancellationToken);
        }
    }
}
