using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationDeadlineLifecycleTests
{
    [Fact]
    public void ApprovalDeadline_IsOptionalAndIndexedWithStatus()
    {
        using var dbContext = CreateContext();
        var reservationType = dbContext.Model.FindEntityType(typeof(Reservation));
        Assert.NotNull(reservationType);

        var deadline = reservationType.FindProperty(nameof(Reservation.ApprovalExpiresAtUtc));
        Assert.NotNull(deadline);
        Assert.True(deadline.IsNullable);
        Assert.Contains(
            reservationType.GetIndexes(),
            index => index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(Reservation.Status), nameof(Reservation.ApprovalExpiresAtUtc)]));
    }

    [Fact]
    public async Task SeedData_ProvidesCanonicalReservationTimingDefaults()
    {
        await using var dbContext = CreateContext();

        await SeedData.InitializeAsync(dbContext);

        var values = await dbContext.SiteSettings.AsNoTracking()
            .Where(setting =>
                setting.Key == ReservationPaymentWindowSettings.SettingKey ||
                setting.Key == ReservationOwnerApprovalWindowSettings.SettingKey ||
                setting.Key == ReservationOwnerApprovalReminderSettings.SettingKey)
            .ToDictionaryAsync(setting => setting.Key, setting => setting.Value);
        Assert.Equal("10", values[ReservationPaymentWindowSettings.SettingKey]);
        Assert.Equal("10", values[ReservationOwnerApprovalWindowSettings.SettingKey]);
        Assert.Equal("3", values[ReservationOwnerApprovalReminderSettings.SettingKey]);
    }

    [Theory]
    [InlineData(ReservationPaymentWindowSettings.SettingKey, "0")]
    [InlineData(ReservationPaymentWindowSettings.SettingKey, "invalid")]
    [InlineData(ReservationOwnerApprovalWindowSettings.SettingKey, "-1")]
    [InlineData(ReservationOwnerApprovalWindowSettings.SettingKey, "10081")]
    [InlineData(ReservationOwnerApprovalReminderSettings.SettingKey, "0")]
    [InlineData(ReservationOwnerApprovalReminderSettings.SettingKey, "10081")]
    public async Task RuntimeDeadlineSettings_RejectMalformedOrOutOfRangeValues(
        string key,
        string value)
    {
        await using var dbContext = CreateContext();
        dbContext.SiteSettings.Add(new SiteSetting
        {
            Key = key,
            Value = value,
            Type = SiteSettingType.Number,
            Group = "Reservation",
            Label = key,
            IsActive = true
        });
        await dbContext.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => key switch
        {
            ReservationPaymentWindowSettings.SettingKey =>
                ReservationPaymentWindowSettings.GetMinutesAsync(dbContext, CancellationToken.None),
            ReservationOwnerApprovalWindowSettings.SettingKey =>
                ReservationOwnerApprovalWindowSettings.GetMinutesAsync(dbContext, CancellationToken.None),
            _ => ReservationOwnerApprovalReminderSettings.GetMinutesAsync(dbContext, CancellationToken.None)
        });

        Assert.Contains(key, error.Message);
    }

    [Fact]
    public async Task HostedService_ProcessesDuePendingApprovals()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(
            ReservationStatus.PendingApproval,
            approvalExpiresAtUtc: DateTime.UtcNow.AddMinutes(-1));
        using var services = new ServiceCollection()
            .AddSingleton<IReservationService>(harness.Service)
            .BuildServiceProvider();
        var hostedService = new ReservationExpirationHostedService(
            services.GetRequiredService<IServiceScopeFactory>(),
            TimeProvider.System,
            NullLogger<ReservationExpirationHostedService>.Instance);

        await hostedService.RunOnceAsync(CancellationToken.None);

        Assert.Equal(ReservationStatus.Rejected, reservation.Status);
    }

    [Fact]
    public async Task ReminderHostedService_UsesOneMinuteScanAndBoundedBatch()
    {
        var now = new DateTimeOffset(2035, 1, 1, 12, 0, 0, TimeSpan.Zero);
        var reminderService = new RecordingApprovalReminderService();
        using var services = new ServiceCollection()
            .AddSingleton<IReservationApprovalReminderService>(reminderService)
            .BuildServiceProvider();
        var hostedService = new ReservationApprovalReminderHostedService(
            services.GetRequiredService<IServiceScopeFactory>(),
            new FixedTimeProvider(now),
            NullLogger<ReservationApprovalReminderHostedService>.Instance);

        await hostedService.RunOnceAsync(CancellationToken.None);

        Assert.Equal(TimeSpan.FromMinutes(1), ReservationApprovalReminderHostedService.Interval);
        Assert.Equal(100, reminderService.BatchSize);
        Assert.Equal(now.UtcDateTime, reminderService.NowUtc);
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"reservation-deadlines-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings =>
                warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new KoochDbContext(options);
    }
}

internal sealed class RecordingApprovalReminderService : IReservationApprovalReminderService
{
    public DateTime? NowUtc { get; private set; }
    public int? BatchSize { get; private set; }

    public Task<int> ProcessDueAsync(
        DateTime nowUtc,
        int batchSize,
        CancellationToken cancellationToken = default)
    {
        NowUtc = nowUtc;
        BatchSize = batchSize;
        return Task.FromResult(0);
    }
}

internal sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}
