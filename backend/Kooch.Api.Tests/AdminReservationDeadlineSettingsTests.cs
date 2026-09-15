using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.ReservationSettings;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AdminReservationDeadlineSettingsTests
{
    private const int SuperAdminId = 1;
    private const int AdminAssistantId = 2;

    [Fact]
    public void DeadlineEndpoints_UseDedicatedRoutesUnderCanonicalAdminAuthorization()
    {
        var authorize = Assert.Single(
            typeof(AdminReservationSettingsController)
                .GetCustomAttributes<AdminAuthorizeAttribute>());
        var getRoute = Assert.Single(
            typeof(AdminReservationSettingsController)
                .GetMethod(nameof(AdminReservationSettingsController.GetDeadlines))!
                .GetCustomAttributes<HttpGetAttribute>());
        var putRoute = Assert.Single(
            typeof(AdminReservationSettingsController)
                .GetMethod(nameof(AdminReservationSettingsController.UpdateDeadlines))!
                .GetCustomAttributes<HttpPutAttribute>());

        Assert.Equal(AuthorizationPolicies.AdminUsers, authorize.Policy);
        Assert.Equal("deadlines", getRoute.Template);
        Assert.Equal("deadlines", putRoute.Template);
    }

    [Fact]
    public async Task GetDeadlines_ReturnsExactCurrentValuesMappedToDedicatedFields()
    {
        await using var dbContext = CreateContext();
        AddDeadlines(dbContext, payment: "11", approval: "22", reminder: "33");
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);

        var response = GetValue(await controller.GetDeadlines(CancellationToken.None));

        Assert.Equal(new ReservationDeadlineSettingsResponse(11, 22, 33), response);
    }

    [Fact]
    public async Task DeadlineEndpoints_AdminAssistantRequiresManageSettings()
    {
        await using var allowedContext = CreateContext();
        await SeedAdminAssistantAsync(allowedContext, hasManageSettings: true);
        AddDeadlines(allowedContext, "10", "10", "3");
        await allowedContext.SaveChangesAsync();
        var allowedController = CreateController(
            allowedContext,
            CreatePermissionService(allowedContext),
            AdminAssistantId,
            UserRole.AdminAssistant);

        var allowed = GetValue(await allowedController.GetDeadlines(CancellationToken.None));

        Assert.Equal(new ReservationDeadlineSettingsResponse(10, 10, 3), allowed);

        await using var deniedContext = CreateContext();
        await SeedAdminAssistantAsync(deniedContext, hasManageSettings: false);
        AddDeadlines(deniedContext, "10", "10", "3");
        await deniedContext.SaveChangesAsync();
        var deniedController = CreateController(
            deniedContext,
            CreatePermissionService(deniedContext),
            AdminAssistantId,
            UserRole.AdminAssistant);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            deniedController.GetDeadlines(CancellationToken.None));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            deniedController.UpdateDeadlines(
                new UpdateReservationDeadlineSettingsRequest(20, 30, 5),
                CancellationToken.None));
    }

    [Theory]
    [InlineData("reservation.paymentWindowMinutes", null)]
    [InlineData("reservation.paymentWindowMinutes", "invalid")]
    [InlineData("reservation.ownerApprovalWindowMinutes", null)]
    [InlineData("reservation.ownerApprovalWindowMinutes", "10.5")]
    [InlineData("reservation.ownerApprovalReminderIntervalMinutes", null)]
    [InlineData("reservation.ownerApprovalReminderIntervalMinutes", "10081")]
    public async Task GetDeadlines_MissingOrMalformedSettingUsesRuntimeFailureConvention(
        string affectedKey,
        string? value)
    {
        await using var dbContext = CreateContext();
        AddDeadlines(dbContext, "10", "10", "3", affectedKey, value);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            controller.GetDeadlines(CancellationToken.None));

        Assert.Contains(affectedKey, error.Message);
    }

    [Fact]
    public async Task UpdateDeadlines_PersistsAllThreeAndSubsequentGetReturnsThem()
    {
        await using var dbContext = CreateContext();
        AddDeadlines(dbContext, "10", "10", "3");
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);
        var request = new UpdateReservationDeadlineSettingsRequest(45, 90, 15);

        var updated = GetValue(await controller.UpdateDeadlines(request, CancellationToken.None));
        dbContext.ChangeTracker.Clear();
        var read = GetValue(await controller.GetDeadlines(CancellationToken.None));
        var persisted = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => DeadlineKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);

        var expected = new ReservationDeadlineSettingsResponse(45, 90, 15);
        Assert.Equal(expected, updated);
        Assert.Equal(expected, read);
        Assert.Equal("45", persisted[ReservationPaymentWindowSettings.SettingKey]);
        Assert.Equal("90", persisted[ReservationOwnerApprovalWindowSettings.SettingKey]);
        Assert.Equal("15", persisted[ReservationOwnerApprovalReminderSettings.SettingKey]);
    }

    [Theory]
    [InlineData(0, 10, 3)]
    [InlineData(-1, 10, 3)]
    [InlineData(10081, 10, 3)]
    [InlineData(10, 0, 3)]
    [InlineData(10, -1, 3)]
    [InlineData(10, 10081, 3)]
    [InlineData(10, 10, 0)]
    [InlineData(10, 10, -1)]
    [InlineData(10, 10, 10081)]
    public async Task UpdateDeadlines_InvalidFieldRejectsBeforeAnyValueChanges(
        int payment,
        int approval,
        int reminder)
    {
        await using var dbContext = CreateContext();
        AddDeadlines(dbContext, "10", "20", "3");
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);

        await Assert.ThrowsAsync<ArgumentException>(() => controller.UpdateDeadlines(
            new UpdateReservationDeadlineSettingsRequest(payment, approval, reminder),
            CancellationToken.None));

        await AssertPersistedValuesAsync(dbContext, "10", "20", "3");
    }

    [Fact]
    public void UpdateDeadlineDto_RequiresIntegerValuesWithinTheCanonicalRange()
    {
        Assert.Empty(Validate(new UpdateReservationDeadlineSettingsRequest(1, 10080, 3)));
        Assert.NotEmpty(Validate(new UpdateReservationDeadlineSettingsRequest(0, 10, 3)));
        Assert.NotEmpty(Validate(new UpdateReservationDeadlineSettingsRequest(10, 10081, 3)));

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<UpdateReservationDeadlineSettingsRequest>(
            "{\"paymentWindowMinutes\":10.5,\"ownerApprovalWindowMinutes\":10,\"ownerApprovalReminderIntervalMinutes\":3}",
            JsonSerializerOptions.Web));
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<UpdateReservationDeadlineSettingsRequest>(
            "{\"paymentWindowMinutes\":\"invalid\",\"ownerApprovalWindowMinutes\":10,\"ownerApprovalReminderIntervalMinutes\":3}",
            JsonSerializerOptions.Web));
    }

    [Fact]
    public async Task UpdateDeadlines_MissingSettingRejectsWithoutPersistingOtherValues()
    {
        await using var dbContext = CreateContext();
        AddDeadlines(
            dbContext,
            payment: "10",
            approval: "20",
            reminder: "3",
            affectedKey: ReservationOwnerApprovalWindowSettings.SettingKey,
            affectedValue: null);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => controller.UpdateDeadlines(
            new UpdateReservationDeadlineSettingsRequest(40, 50, 6),
            CancellationToken.None));

        dbContext.ChangeTracker.Clear();
        Assert.Equal(
            "10",
            (await dbContext.SiteSettings.SingleAsync(
                setting => setting.Key == ReservationPaymentWindowSettings.SettingKey)).Value);
        Assert.Equal(
            "3",
            (await dbContext.SiteSettings.SingleAsync(
                setting => setting.Key == ReservationOwnerApprovalReminderSettings.SettingKey)).Value);
    }

    [Fact]
    public async Task UpdateDeadlines_SaveFailureLeavesAllThreePersistedValuesUnchanged()
    {
        var options = CreateOptions("reservation-deadline-save-failure");
        await using var dbContext = new FailingKoochDbContext(options);
        AddDeadlines(dbContext, "10", "20", "3");
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);
        dbContext.FailNextSave();

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.UpdateDeadlines(
            new UpdateReservationDeadlineSettingsRequest(40, 50, 6),
            CancellationToken.None));

        await AssertPersistedValuesAsync(dbContext, "10", "20", "3");
    }

    [Fact]
    public async Task ChildPricingEndpointsRemainIndependentFromDeadlineUpdates()
    {
        await using var dbContext = CreateContext();
        AddDeadlines(dbContext, "10", "20", "3");
        dbContext.SiteSettings.AddRange(
            Setting(ChildPricingRuleResolver.FreeChildMaxAgeKey, "6"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMinAgeKey, "7"),
            Setting(ChildPricingRuleResolver.HalfPriceChildMaxAgeKey, "12"),
            Setting(ChildPricingRuleResolver.HalfPriceChildRateKey, "50"));
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext, null!, SuperAdminId, UserRole.SuperAdmin);

        await controller.UpdateDeadlines(
            new UpdateReservationDeadlineSettingsRequest(40, 50, 6),
            CancellationToken.None);
        var childSettings = GetValue(await controller.Get(CancellationToken.None));

        Assert.Equal(new ReservationSettingsResponse(6, 7, 12, 50m), childSettings);
    }

    private static AdminReservationSettingsController CreateController(
        KoochDbContext dbContext,
        IPermissionService permissionService,
        int userId,
        UserRole role)
    {
        var controller = new AdminReservationSettingsController(
            dbContext,
            permissionService,
            new ChildPricingRuleResolver(dbContext));
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                        new Claim(ClaimTypes.Role, role.ToString())
                    ],
                    nameof(AdminReservationDeadlineSettingsTests)))
            }
        };
        return controller;
    }

    private static void AddDeadlines(
        KoochDbContext dbContext,
        string payment,
        string approval,
        string reminder,
        string? affectedKey = null,
        string? affectedValue = null)
    {
        var values = new Dictionary<string, string>
        {
            [ReservationPaymentWindowSettings.SettingKey] = payment,
            [ReservationOwnerApprovalWindowSettings.SettingKey] = approval,
            [ReservationOwnerApprovalReminderSettings.SettingKey] = reminder
        };
        if (affectedKey is not null)
        {
            if (affectedValue is null)
            {
                values.Remove(affectedKey);
            }
            else
            {
                values[affectedKey] = affectedValue;
            }
        }

        dbContext.SiteSettings.AddRange(values.Select(pair => Setting(pair.Key, pair.Value)));
    }

    private static SiteSetting Setting(string key, string value) => new()
    {
        Key = key,
        Value = value,
        Type = SiteSettingType.Number,
        Group = "Reservation",
        Label = key,
        IsActive = true
    };

    private static async Task SeedAdminAssistantAsync(
        KoochDbContext dbContext,
        bool hasManageSettings)
    {
        dbContext.Users.Add(new User
        {
            Id = AdminAssistantId,
            FirstName = "Admin",
            LastName = "Assistant",
            Email = "reservation-settings-admin@example.test",
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

    private static PermissionService CreatePermissionService(KoochDbContext dbContext) =>
        new(dbContext, new PropertyAccessService(dbContext));

    private static IReadOnlyList<ValidationResult> Validate(object value)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(value, new ValidationContext(value), results, true);
        return results;
    }

    private static async Task AssertPersistedValuesAsync(
        KoochDbContext dbContext,
        string payment,
        string approval,
        string reminder)
    {
        dbContext.ChangeTracker.Clear();
        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting => DeadlineKeys.Contains(setting.Key))
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);
        Assert.Equal(payment, values[ReservationPaymentWindowSettings.SettingKey]);
        Assert.Equal(approval, values[ReservationOwnerApprovalWindowSettings.SettingKey]);
        Assert.Equal(reminder, values[ReservationOwnerApprovalReminderSettings.SettingKey]);
    }

    private static T GetValue<T>(ActionResult<T> response) =>
        Assert.IsType<T>(Assert.IsType<OkObjectResult>(response.Result).Value);

    private static KoochDbContext CreateContext() => new(CreateOptions(
        $"reservation-deadline-settings-{Guid.NewGuid():N}"));

    private static DbContextOptions<KoochDbContext> CreateOptions(string databaseName) =>
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(databaseName)
            .ConfigureWarnings(warnings =>
                warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static readonly string[] DeadlineKeys =
    [
        ReservationPaymentWindowSettings.SettingKey,
        ReservationOwnerApprovalWindowSettings.SettingKey,
        ReservationOwnerApprovalReminderSettings.SettingKey
    ];

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
                throw new DbUpdateException("Simulated deadline persistence failure.");
            }

            return base.SaveChangesAsync(cancellationToken);
        }
    }
}
