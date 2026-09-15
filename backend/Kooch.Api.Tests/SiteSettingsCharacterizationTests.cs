using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.ReservationSettings;
using Kooch.Api.Dtos.SiteSettings;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SiteSettingsCharacterizationTests
{
    private const int SuperAdminId = 1;
    private const int AdminAssistantId = 2;

    [Fact]
    public void AdminEndpoints_UseTheCanonicalAdminRolePolicy()
    {
        var authorize = Assert.Single(
            typeof(AdminSiteSettingsController)
                .GetCustomAttributes<AdminAuthorizeAttribute>());

        Assert.Equal(AuthorizationPolicies.AdminUsers, authorize.Policy);
    }

    [Fact]
    public async Task AdminGet_SuperAdmin_ReturnsNonDeletedSettingsOrderedByGroupThenSortOrder()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting("brand.second", "value", "Brand", 20),
            Setting("footer.first", "value", "Footer", 10),
            Setting("brand.first", "value", "Brand", 10),
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "6", "Reservation", 1),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "7", "Reservation", 2),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12", "Reservation", 3),
            Setting(ChildPricingRuleResolver.HalfPriceChildRateKey, "50", "Reservation", 4),
            Setting("reservation.paymentWindowMinutes", "10", "Reservation", 10),
            Setting("reservation.ownerApprovalWindowMinutes", "10", "Reservation", 20),
            Setting("reservation.ownerApprovalReminderIntervalMinutes", "3", "Reservation", 30),
            Setting("brand.deleted", "value", "Brand", 1, isDeleted: true));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            permissionService: null!,
            SuperAdminId,
            UserRole.SuperAdmin);

        var settings = await GetAdminSettingsAsync(controller);

        Assert.Equal(
            [
                "brand.first",
                "brand.second",
                "footer.first",
                "reservation.paymentWindowMinutes",
                "reservation.ownerApprovalWindowMinutes",
                "reservation.ownerApprovalReminderIntervalMinutes"
            ],
            settings.Select(setting => setting.Key).ToArray());
        Assert.All(
            ChildPricingRuleResolver.SettingKeys,
            key => Assert.DoesNotContain(key, settings.Select(setting => setting.Key)));
    }

    [Fact]
    public async Task AdminGet_AdminAssistantWithManageSettings_IsAllowed()
    {
        await using var dbContext = CreateContext();
        await SeedAdminAssistantAsync(dbContext, hasManageSettings: true);
        dbContext.SiteSettings.Add(Setting("site.name", "Kooch", "Brand", 10));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            CreatePermissionService(dbContext),
            AdminAssistantId,
            UserRole.AdminAssistant);

        var settings = await GetAdminSettingsAsync(controller);

        Assert.Collection(settings, setting => Assert.Equal("site.name", setting.Key));
    }

    [Fact]
    public async Task AdminGetAndPut_AdminAssistantWithoutManageSettings_AreRejected()
    {
        await using var dbContext = CreateContext();
        await SeedAdminAssistantAsync(dbContext, hasManageSettings: false);
        dbContext.SiteSettings.Add(Setting("site.name", "Kooch", "Brand", 10));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            CreatePermissionService(dbContext),
            AdminAssistantId,
            UserRole.AdminAssistant);

        var getError = await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            controller.Get(CancellationToken.None));
        var putError = await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            controller.Update(
                "site.name",
                new UpdateSiteSettingRequest("changed"),
                CancellationToken.None));

        Assert.Equal(StatusCodes.Status403Forbidden, MapStatusCode(getError));
        Assert.Equal(StatusCodes.Status403Forbidden, MapStatusCode(putError));
        Assert.Equal(
            "Kooch",
            (await dbContext.SiteSettings.SingleAsync(setting => setting.Key == "site.name")).Value);
    }

    [Fact]
    public async Task AdminPut_AuthorizedUpdateTrimsAndPersistsTheValueForTheNextRead()
    {
        await using var dbContext = CreateContext();
        await SeedAdminAssistantAsync(dbContext, hasManageSettings: true);
        dbContext.SiteSettings.Add(Setting("site.name", "Kooch", "Brand", 10));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            CreatePermissionService(dbContext),
            AdminAssistantId,
            UserRole.AdminAssistant);

        var response = await controller.Update(
            "site.name",
            new UpdateSiteSettingRequest("  Updated Kooch  "),
            CancellationToken.None);
        var updated = GetSiteSetting(response);
        dbContext.ChangeTracker.Clear();
        var read = Assert.Single(await GetAdminSettingsAsync(controller));

        Assert.Equal("Updated Kooch", updated.Value);
        Assert.Equal("Updated Kooch", read.Value);
        Assert.Equal(
            "Updated Kooch",
            (await dbContext.SiteSettings.SingleAsync(setting => setting.Key == "site.name")).Value);
    }

    [Theory]
    [InlineData(ChildPricingRuleResolver.FreeChildMaxAgeKey)]
    [InlineData(ChildPricingRuleResolver.HalfPriceChildMinAgeKey)]
    [InlineData(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey)]
    [InlineData(ChildPricingRuleResolver.HalfPriceChildRateKey)]
    public async Task AdminPut_RejectsSpecializedChildPricingKeysWithoutMutation(string key)
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.Add(Setting(key, "original", "Reservation", 10));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            permissionService: null!,
            SuperAdminId,
            UserRole.SuperAdmin);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            controller.Update(
                key,
                new UpdateSiteSettingRequest("changed"),
                CancellationToken.None));
        dbContext.ChangeTracker.Clear();

        Assert.Equal(StatusCodes.Status409Conflict, MapStatusCode(error));
        Assert.Contains("reservation settings", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(
            "original",
            (await dbContext.SiteSettings.SingleAsync(setting => setting.Key == key)).Value);
    }

    [Theory]
    [InlineData("reservation.paymentWindowMinutes")]
    [InlineData("reservation.ownerApprovalWindowMinutes")]
    [InlineData("reservation.ownerApprovalReminderIntervalMinutes")]
    public async Task AdminPut_StillUpdatesReservationDeadlineKeys(string key)
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.Add(Setting(key, "10", "Reservation", 10));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            permissionService: null!,
            SuperAdminId,
            UserRole.SuperAdmin);

        var response = await controller.Update(
            key,
            new UpdateSiteSettingRequest("15"),
            CancellationToken.None);

        Assert.Equal("15", GetSiteSetting(response).Value);
        Assert.Equal(
            "15",
            (await dbContext.SiteSettings.SingleAsync(setting => setting.Key == key)).Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task AdminPut_NullOrBlankValue_IsCurrentlyNormalizedToEmpty(string? value)
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.Add(Setting("site.footerText", "Existing", "Footer", 10));
        await dbContext.SaveChangesAsync();
        var controller = CreateAdminController(
            dbContext,
            permissionService: null!,
            SuperAdminId,
            UserRole.SuperAdmin);

        var response = await controller.Update(
            "site.footerText",
            new UpdateSiteSettingRequest(value!),
            CancellationToken.None);

        Assert.Equal(string.Empty, GetSiteSetting(response).Value);
        Assert.Equal(
            string.Empty,
            (await dbContext.SiteSettings.SingleAsync(setting => setting.Key == "site.footerText")).Value);
    }

    [Fact]
    public async Task AdminPut_UnknownKey_IsMappedToNotFoundByTheCurrentApiFilter()
    {
        await using var dbContext = CreateContext();
        var controller = CreateAdminController(
            dbContext,
            permissionService: null!,
            SuperAdminId,
            UserRole.SuperAdmin);

        var error = await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            controller.Update(
                "missing.key",
                new UpdateSiteSettingRequest("value"),
                CancellationToken.None));

        Assert.Equal(StatusCodes.Status404NotFound, MapStatusCode(error));
    }

    [Fact]
    public async Task PublicGet_IsAnonymousAndReturnsExactlyTheActiveNonDeletedPublicWhitelist()
    {
        Assert.Empty(
            typeof(SiteSettingsController)
                .GetCustomAttributes<AuthorizeAttribute>());
        var method = typeof(SiteSettingsController).GetMethod(nameof(SiteSettingsController.GetPublic));
        Assert.Empty(method!.GetCustomAttributes<AuthorizeAttribute>());

        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting("site.name", "  Kooch Raw  ", "Brand", 10),
            Setting("site.logoUrl", "/logo.svg", "Brand", 20),
            Setting("site.footerText", "Footer", "Footer", 10),
            Setting("home.heroTitle", "Hero", "Home", 10),
            Setting("home.heroSubtitle", "Subtitle", "Home", 20),
            Setting("home.heroBackgroundUrl", "/hero.jpg", "Home", 30),
            Setting("home.searchButtonText", "Search", "Home", 40),
            Setting("home.popularSectionTitle", "Popular", "Home", 50),
            Setting("home.popularSectionSubtitle", "Popular subtitle", "Home", 60),
            Setting("site.defaultSeoTitle", "SEO title", "Seo", 10),
            Setting("site.defaultSeoDescription", "SEO description", "Seo", 20),
            Setting("pricing.currencyLabel", "Toman", "Pricing", 10),
            Setting("image.maxFileSizeMb", "2", "Images", 10),
            Setting("image.minWidth", "800", "Images", 20),
            Setting("image.minHeight", "600", "Images", 30),
            Setting("image.maxImagesPerProperty", "30", "Images", 40),
            Setting("image.enableWebpConversion", "true", "Images", 50),
            Setting("pricing.minPrice", "100000", "Pricing", 20),
            Setting("pricing.maxPrice", "50000000", "Pricing", 30),
            Setting("reservation.freeChildMaxAge", "6", "Reservation", 10),
            Setting("reservation.halfPriceChildMinAge", "7", "Reservation", 20),
            Setting("reservation.halfPriceChildMaxAge", "12", "Reservation", 30),
            Setting("reservation.halfPriceChildRate", "50", "Reservation", 40),
            Setting("reservation.paymentWindowMinutes", "10", "Reservation", 50),
            Setting("reservation.ownerApprovalWindowMinutes", "60", "Reservation", 60),
            Setting("reservation.ownerApprovalReminderIntervalMinutes", "15", "Reservation", 70),
            Setting("ReservationCommissionPercent", "5", "Reservation", 20),
            Setting("ReferralCommissionPercent", "4", "Commission", 20),
            Setting("CommissionType3Percent", "3", "Commission", 30),
            Setting("future.internalSetting", "hidden", "Future", 10));
        await dbContext.SaveChangesAsync();

        var settings = await GetPublicAsync(new SiteSettingsController(dbContext));

        Assert.Equal(PublicSettingKeys.Order(), settings.Keys.Order());
        Assert.Equal("  Kooch Raw  ", settings["site.name"]);
        Assert.All(NonPublicSettingKeys, key => Assert.DoesNotContain(key, settings.Keys));
    }

    [Fact]
    public async Task PublicGet_OmitsInactiveDeletedAndMissingWhitelistedKeys()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting("site.name", "inactive", "Brand", 10, isActive: false),
            Setting("site.logoUrl", "deleted", "Brand", 20, isDeleted: true),
            Setting("site.footerText", "visible", "Footer", 10));
        await dbContext.SaveChangesAsync();

        var settings = await GetPublicAsync(new SiteSettingsController(dbContext));

        var setting = Assert.Single(settings);
        Assert.Equal("site.footerText", setting.Key);
        Assert.Equal("visible", setting.Value);
        Assert.DoesNotContain("site.name", settings.Keys);
        Assert.DoesNotContain("site.logoUrl", settings.Keys);
        Assert.DoesNotContain("home.heroTitle", settings.Keys);
    }

    [Fact]
    public async Task ReservationSettingsGetAndUpdate_RemainCanonicalForChildPricingKeys()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "6", "Reservation", 10),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "7", "Reservation", 20),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12", "Reservation", 30),
            Setting(ChildPricingRuleResolver.HalfPriceChildRateKey, "50", "Reservation", 40));
        await dbContext.SaveChangesAsync();
        var reservationController = new AdminReservationSettingsController(
            dbContext,
            permissionService: null!,
            new ChildPricingRuleResolver(dbContext));
        SetCurrentUser(reservationController, SuperAdminId, UserRole.SuperAdmin);

        await reservationController.Update(
            new UpdateReservationSettingsRequest(5, 6, 11, 45m),
            CancellationToken.None);

        var getResponse = await reservationController.Get(CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(getResponse.Result);
        var reservationSettings = Assert.IsType<ReservationSettingsResponse>(ok.Value);
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => ChildPricingRuleResolver.SettingKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);

        Assert.Equal(new ReservationSettingsResponse(5, 6, 11, 45m), reservationSettings);
        Assert.Equal("5", values[ChildPricingRuleResolver.FreeChildMaxAgeKey]);
        Assert.Equal("6", values[ChildPricingRuleResolver.HalfPriceChildMinAgeKey]);
        Assert.Equal("11", values[ChildPricingRuleResolver.HalfPriceChildMaxAgeKey]);
        Assert.Equal("45", values[ChildPricingRuleResolver.HalfPriceChildRateKey]);
    }

    [Theory]
    [InlineData(-1, 7, 12, 50)]
    [InlineData(6, 13, 12, 50)]
    [InlineData(6, 7, 18, 50)]
    [InlineData(6, 7, 12, 101)]
    public async Task ReservationSettingsUpdate_InvalidChildRulesLeaveAllFourValuesUnchanged(
        int freeChildMaxAge,
        int halfPriceChildMinAge,
        int halfPriceChildMaxAge,
        decimal halfPriceChildRate)
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.AddRange(
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "6", "Reservation", 10),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "7", "Reservation", 20),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12", "Reservation", 30),
            Setting(ChildPricingRuleResolver.HalfPriceChildRateKey, "50", "Reservation", 40));
        await dbContext.SaveChangesAsync();
        var controller = new AdminReservationSettingsController(
            dbContext,
            permissionService: null!,
            new ChildPricingRuleResolver(dbContext));
        SetCurrentUser(controller, SuperAdminId, UserRole.SuperAdmin);

        await Assert.ThrowsAsync<ArgumentException>(() => controller.Update(
            new UpdateReservationSettingsRequest(
                freeChildMaxAge,
                halfPriceChildMinAge,
                halfPriceChildMaxAge,
                halfPriceChildRate),
            CancellationToken.None));
        dbContext.ChangeTracker.Clear();

        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => ChildPricingRuleResolver.SettingKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);
        Assert.Equal("6", values[ChildPricingRuleResolver.FreeChildMaxAgeKey]);
        Assert.Equal("7", values[ChildPricingRuleResolver.HalfPriceChildMinAgeKey]);
        Assert.Equal("12", values[ChildPricingRuleResolver.HalfPriceChildMaxAgeKey]);
        Assert.Equal("50", values[ChildPricingRuleResolver.HalfPriceChildRateKey]);
    }

    [Fact]
    public async Task Seed_PreservesExistingValueButRefreshesMetadataAndReactivatesCanonicalSetting()
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.Add(new SiteSetting
        {
            Key = "site.name",
            Value = "Persisted admin value",
            Type = SiteSettingType.Boolean,
            Group = "Outdated",
            Label = "Outdated label",
            Description = "Outdated description",
            SortOrder = 999,
            IsActive = false,
            IsDeleted = true,
            DeletedAtUtc = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
            DeletedByUserId = 99
        });
        await dbContext.SaveChangesAsync();
        dbContext.ChangeTracker.Clear();

        await SeedData.InitializeAsync(dbContext);
        dbContext.ChangeTracker.Clear();

        var setting = await dbContext.SiteSettings.IgnoreQueryFilters()
            .SingleAsync(item => item.Key == "site.name");
        Assert.Equal("Persisted admin value", setting.Value);
        Assert.Equal(SiteSettingType.Text, setting.Type);
        Assert.Equal("Brand", setting.Group);
        Assert.Equal("نام سایت", setting.Label);
        Assert.Null(setting.Description);
        Assert.Equal(10, setting.SortOrder);
        Assert.True(setting.IsActive);
        Assert.False(setting.IsDeleted);
        Assert.Null(setting.DeletedAtUtc);
        Assert.Null(setting.DeletedByUserId);
    }

    private static AdminSiteSettingsController CreateAdminController(
        KoochDbContext dbContext,
        IPermissionService permissionService,
        int userId,
        UserRole role)
    {
        var controller = new AdminSiteSettingsController(
            dbContext,
            permissionService,
            uploadService: null!);
        SetCurrentUser(controller, userId, role);
        return controller;
    }

    private static PermissionService CreatePermissionService(KoochDbContext dbContext)
    {
        var propertyAccessService = new PropertyAccessService(dbContext);
        return new PermissionService(dbContext, propertyAccessService);
    }

    private static async Task SeedAdminAssistantAsync(
        KoochDbContext dbContext,
        bool hasManageSettings)
    {
        dbContext.Users.Add(new User
        {
            Id = AdminAssistantId,
            FirstName = "Admin",
            LastName = "Assistant",
            Email = "admin-assistant@example.test",
            PasswordHash = "not-used",
            Role = UserRole.AdminAssistant,
            IsActive = true
        });
        if (hasManageSettings)
        {
            dbContext.UserPermissions.Add(new UserPermission
            {
                UserId = AdminAssistantId,
                PermissionKey = PermissionKey.ManageSettings,
                IsAllowed = true
            });
        }

        await dbContext.SaveChangesAsync();
    }

    private static SiteSetting Setting(
        string key,
        string value,
        string group,
        int sortOrder,
        bool isActive = true,
        bool isDeleted = false) => new()
    {
        Key = key,
        Value = value,
        Type = SiteSettingType.Text,
        Group = group,
        Label = key,
        SortOrder = sortOrder,
        IsActive = isActive,
        IsDeleted = isDeleted
    };

    private static void SetCurrentUser(
        ControllerBase controller,
        int userId,
        UserRole role)
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
                    "SiteSettingsCharacterizationTests"))
            }
        };
    }

    private static async Task<IReadOnlyList<SiteSettingResponse>> GetAdminSettingsAsync(
        AdminSiteSettingsController controller)
    {
        var response = await controller.Get(CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        return Assert.IsAssignableFrom<IReadOnlyList<SiteSettingResponse>>(ok.Value);
    }

    private static async Task<Dictionary<string, string>> GetPublicAsync(
        SiteSettingsController controller)
    {
        var response = await controller.GetPublic(CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(response.Result);
        return Assert.IsType<Dictionary<string, string>>(ok.Value);
    }

    private static SiteSettingResponse GetSiteSetting(
        ActionResult<SiteSettingResponse> response) =>
        Assert.IsType<SiteSettingResponse>(
            Assert.IsType<OkObjectResult>(response.Result).Value);

    private static readonly string[] PublicSettingKeys =
    [
        "site.name",
        "site.logoUrl",
        "site.footerText",
        "home.heroTitle",
        "home.heroSubtitle",
        "home.heroBackgroundUrl",
        "home.searchButtonText",
        "home.popularSectionTitle",
        "home.popularSectionSubtitle",
        "site.defaultSeoTitle",
        "site.defaultSeoDescription",
        "pricing.currencyLabel"
    ];

    private static readonly string[] NonPublicSettingKeys =
    [
        "image.maxFileSizeMb",
        "image.minWidth",
        "image.minHeight",
        "image.maxImagesPerProperty",
        "image.enableWebpConversion",
        "pricing.minPrice",
        "pricing.maxPrice",
        "reservation.freeChildMaxAge",
        "reservation.halfPriceChildMinAge",
        "reservation.halfPriceChildMaxAge",
        "reservation.halfPriceChildRate",
        "reservation.paymentWindowMinutes",
        "reservation.ownerApprovalWindowMinutes",
        "reservation.ownerApprovalReminderIntervalMinutes",
        "ReservationCommissionPercent",
        "ReferralCommissionPercent",
        "CommissionType3Percent",
        "future.internalSetting"
    ];

    private static int MapStatusCode(Exception exception)
    {
        var actionContext = new ActionContext(
            new DefaultHttpContext(),
            new RouteData(),
            new ActionDescriptor());
        var context = new ExceptionContext(actionContext, [])
        {
            Exception = exception
        };
        new ApiExceptionFilter().OnException(context);

        return Assert.IsType<ObjectResult>(context.Result).StatusCode!.Value;
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"site-settings-characterization-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings =>
                warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new KoochDbContext(options);
    }
}
