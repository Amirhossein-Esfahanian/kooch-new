using Kooch.Api.Data;
using Kooch.Api.Authentication;
using Kooch.Api.Controllers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationNotificationRoutingTests
{
    [Fact]
    public async Task ApprovalReminder_RespectsIntervalCreatesLaterOccurrencesAndNeverNotifiesGuest()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        AddReminderSetting(context, 3);
        AddReservation(context, 30, ReservationStatus.PendingApproval, DateTime.UtcNow.AddMinutes(10));
        await context.SaveChangesAsync();
        var baselineUtc = DateTime.UtcNow;
        var service = CreateReminderService(context);

        Assert.Equal(0, await service.ProcessDueAsync(baselineUtc.AddMinutes(2), 100));
        Assert.Empty(await ReminderLogs(context, 30));

        Assert.Equal(1, await service.ProcessDueAsync(baselineUtc.AddMinutes(4), 100));
        var firstOccurrence = await ReminderLogs(context, 30);
        Assert.Equal(3, firstOccurrence.Count);
        Assert.Equal([1, 2, 6], firstOccurrence.Select(log => log.RecipientUserId!.Value).Order().ToArray());
        Assert.DoesNotContain(firstOccurrence, log => log.RecipientUserId == 20 || log.RecipientGuestId.HasValue);

        await service.ProcessDueAsync(baselineUtc.AddMinutes(4), 100);
        Assert.Equal(3, (await ReminderLogs(context, 30)).Count);

        await service.ProcessDueAsync(baselineUtc.AddMinutes(7), 100);
        var secondOccurrence = await ReminderLogs(context, 30);
        Assert.Equal(6, secondOccurrence.Count);
        Assert.All(secondOccurrence.GroupBy(log => log.RecipientUserId), group => Assert.Equal(2, group.Count()));
        Assert.Equal(6, secondOccurrence.Select(log => log.DedupeKey).Distinct().Count());
    }

    [Theory]
    [InlineData(ReservationStatus.ApprovedAwaitingPayment)]
    [InlineData(ReservationStatus.Confirmed)]
    [InlineData(ReservationStatus.Paid)]
    [InlineData(ReservationStatus.Rejected)]
    [InlineData(ReservationStatus.Cancelled)]
    [InlineData(ReservationStatus.PaymentExpired)]
    [InlineData(ReservationStatus.CapacityLost)]
    public async Task ApprovalReminder_ExcludesNonPendingStatuses(ReservationStatus status)
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        AddReminderSetting(context, 1);
        AddReservation(context, 31, status, DateTime.UtcNow.AddMinutes(10));
        await context.SaveChangesAsync();

        var processed = await CreateReminderService(context)
            .ProcessDueAsync(DateTime.UtcNow.AddMinutes(2), 100);

        Assert.Equal(0, processed);
        Assert.Empty(await ReminderLogs(context, 31));
    }

    [Fact]
    public async Task ApprovalReminder_ExcludesExpiredApprovalDeadline()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        AddReminderSetting(context, 1);
        AddReservation(context, 32, ReservationStatus.PendingApproval, DateTime.UtcNow.AddSeconds(30));
        await context.SaveChangesAsync();

        await CreateReminderService(context).ProcessDueAsync(DateTime.UtcNow.AddMinutes(2), 100);

        Assert.Empty(await ReminderLogs(context, 32));
    }

    [Fact]
    public async Task ApprovalReminder_WhenExpirationWinsRace_DoesNotPersistPostExpiryReminder()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        AddReminderSetting(context, 1);
        AddReservation(context, 36, ReservationStatus.PendingApproval, DateTime.UtcNow.AddMinutes(10));
        await context.SaveChangesAsync();
        var baselineUtc = DateTime.UtcNow;
        var innerDispatcher = CreateDispatcher(context);
        var racingDispatcher = new ExpirationWinningDispatcher(context, innerDispatcher);
        var service = new ReservationApprovalReminderService(context, racingDispatcher);

        await service.ProcessDueAsync(baselineUtc.AddMinutes(2), 100);

        context.ChangeTracker.Clear();
        Assert.Equal(
            ReservationStatus.Rejected,
            (await context.Reservations.SingleAsync(item => item.Id == 36)).Status);
        Assert.Empty(await ReminderLogs(context, 36));
    }

    [Fact]
    public async Task ApprovalReminder_TreatsBookingSessionChildrenIndependently()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        AddReminderSetting(context, 1);
        AddReservation(context, 33, ReservationStatus.PendingApproval, DateTime.UtcNow.AddMinutes(10));
        AddReservation(context, 34, ReservationStatus.ApprovedAwaitingPayment, DateTime.UtcNow.AddMinutes(10));
        await context.SaveChangesAsync();

        await CreateReminderService(context).ProcessDueAsync(DateTime.UtcNow.AddMinutes(2), 100);

        Assert.Equal(3, (await ReminderLogs(context, 33)).Count);
        Assert.Empty(await ReminderLogs(context, 34));
    }

    [Fact]
    public async Task ApprovalReminder_UsesChangedIntervalWithoutChangingDeadline()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        AddReminderSetting(context, 3);
        var deadline = DateTime.UtcNow.AddMinutes(20);
        AddReservation(context, 35, ReservationStatus.PendingApproval, deadline);
        await context.SaveChangesAsync();
        var baselineUtc = DateTime.UtcNow;
        var setting = await context.SiteSettings.SingleAsync();
        setting.Value = "5";
        await context.SaveChangesAsync();
        var service = CreateReminderService(context);

        Assert.Equal(0, await service.ProcessDueAsync(baselineUtc.AddMinutes(4), 100));
        Assert.Equal(1, await service.ProcessDueAsync(baselineUtc.AddMinutes(6), 100));

        context.ChangeTracker.Clear();
        Assert.Equal(deadline, (await context.Reservations.SingleAsync(item => item.Id == 35)).ApprovalExpiresAtUtc);
    }

    [Fact]
    public void FollowUpRecipientApi_IsAdminOnlyAndUsesAnAdminPropertyRoute()
    {
        var controller = typeof(AdminPropertyReservationFollowUpRecipientsController);

        Assert.NotNull(controller.GetCustomAttributes(typeof(AdminAuthorizeAttribute), inherit: true).SingleOrDefault());
        var route = Assert.Single(controller.GetCustomAttributes(typeof(RouteAttribute), inherit: true).Cast<RouteAttribute>());
        Assert.StartsWith("api/admin/properties/", route.Template, StringComparison.Ordinal);
    }

    [Fact]
    public void FollowUpRecipientAndNotificationDedupe_HaveTheApprovedPersistenceShape()
    {
        using var context = new KoochDbContext(
            new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite("Data Source=:memory:")
                .Options);
        var assignment = context.Model.FindEntityType(typeof(PropertyReservationFollowUpRecipient));
        Assert.NotNull(assignment);
        var uniqueAssignment = Assert.Single(
            assignment.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([
                    nameof(PropertyReservationFollowUpRecipient.PropertyId),
                    nameof(PropertyReservationFollowUpRecipient.UserId)
                ]));
        Assert.True(uniqueAssignment.IsUnique);
        Assert.All(assignment.GetForeignKeys(), foreignKey =>
            Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior));

        var notification = context.Model.FindEntityType(typeof(NotificationLog));
        Assert.NotNull(notification);
        Assert.Equal(240, notification.FindProperty(nameof(NotificationLog.DedupeKey))?.GetMaxLength());
        var dedupe = Assert.Single(
            notification.GetIndexes(),
            index => index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(NotificationLog.DedupeKey)]));
        Assert.True(dedupe.IsUnique);
        Assert.Equal("[DedupeKey] IS NOT NULL", dedupe.GetFilter());
    }

    [Fact]
    public async Task Resolver_ReturnsOnlyAuthorizedActivePropertyAndFollowUpRecipients()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        await context.SaveChangesAsync();
        var authorization = CreateAuthorization();
        var resolver = new ReservationNotificationRecipientResolver(
            context,
            new StubPermissionService([6]),
            authorization);

        var recipients = await resolver.ResolveAsync(10);

        Assert.Equal([1, 2, 6], recipients.Select(recipient => recipient.UserId).Order().ToArray());
        Assert.False(recipients.Single(recipient => recipient.UserId == 1).IsPlatformFollowUp);
        Assert.True(recipients.Single(recipient => recipient.UserId == 6).IsPlatformFollowUp);
    }

    [Fact]
    public async Task FollowUpAssignment_RequiresExistingPermissionsAndRejectsDuplicates()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: false);
        context.Users.Add(CreateUser(7, UserRole.AdminAssistant));
        await context.SaveChangesAsync();
        var authorization = CreateAuthorization();
        authorization.Allow(1, 10, "property.edit");
        var permissions = new StubPermissionService([6]);
        var resolver = new ReservationNotificationRecipientResolver(context, permissions, authorization);
        var service = new ReservationFollowUpRecipientService(
            context,
            permissions,
            authorization,
            resolver);

        var assigned = await service.AssignAsync(1, UserRole.SuperAdmin, 10, 6);

        Assert.Equal(6, assigned.UserId);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.AssignAsync(1, UserRole.SuperAdmin, 10, 6));
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.AssignAsync(1, UserRole.SuperAdmin, 10, 7));
    }

    [Fact]
    public async Task FollowUpManagement_RejectsUnauthorizedPlatformActor()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: false);
        context.Users.Add(CreateUser(9, UserRole.AdminAssistant));
        await context.SaveChangesAsync();
        var authorization = CreateAuthorization();
        var permissions = new StubPermissionService([6]);
        var resolver = new ReservationNotificationRecipientResolver(context, permissions, authorization);
        var service = new ReservationFollowUpRecipientService(
            context,
            permissions,
            authorization,
            resolver);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.GetAsync(9, UserRole.AdminAssistant, 10));
    }

    [Fact]
    public async Task PendingApprovalAndTimeout_AreRoutedOnceToGuestAndResponsibleStaff()
    {
        await using var context = CreateContext();
        SeedRecipients(context, includeAssignment: true);
        context.Reservations.Add(new Reservation
        {
            Id = 20,
            ReservationNumber = "KCH-REQUEST-20",
            ClientId = 20,
            PropertyId = 10,
            RoomTypeId = 30,
            CheckInDate = new DateOnly(2035, 1, 1),
            CheckOutDate = new DateOnly(2035, 1, 3),
            AdultCount = 2,
            Currency = "IRR",
            Status = ReservationStatus.PendingApproval,
            Source = ReservationSource.Website,
            ApprovalExpiresAtUtc = DateTime.UtcNow.AddMinutes(30)
        });
        await context.SaveChangesAsync();
        var authorization = CreateAuthorization();
        var resolver = new ReservationNotificationRecipientResolver(
            context,
            new StubPermissionService([6]),
            authorization);
        var dispatcher = new ReservationNotificationDispatcher(
            context,
            new NotificationService(context),
            resolver);

        await dispatcher.NotifyPendingApprovalAsync([20]);
        await dispatcher.NotifyPendingApprovalAsync([20]);

        var createdLogs = await context.NotificationLogs
            .Where(log => log.EventType == NotificationEventType.ReservationPendingApproval ||
                          log.EventType == NotificationEventType.ReservationApprovalRequested)
            .ToListAsync();
        Assert.Equal(4, createdLogs.Count);
        Assert.Single(createdLogs, log => log.RecipientUserId == 20);
        Assert.Equal(3, createdLogs.Count(log => log.EventType == NotificationEventType.ReservationApprovalRequested));
        Assert.All(createdLogs, log =>
        {
            Assert.Equal(10, log.PropertyId);
            Assert.Equal(20, log.ReservationId);
            Assert.False(string.IsNullOrWhiteSpace(log.DedupeKey));
        });

        await dispatcher.NotifyOwnerApprovalTimeoutAsync(20);
        await dispatcher.NotifyOwnerApprovalTimeoutAsync(20);

        var timeoutLogs = await context.NotificationLogs
            .Where(log => log.EventType == NotificationEventType.ReservationOwnerApprovalTimedOut)
            .ToListAsync();
        Assert.Equal(4, timeoutLogs.Count);
        Assert.Single(timeoutLogs, log => log.RecipientUserId == 20);
        Assert.Equal(3, timeoutLogs.Count(log => log.RecipientUserId is 1 or 2 or 6));
        Assert.All(timeoutLogs, log =>
        {
            using var metadata = System.Text.Json.JsonDocument.Parse(log.DataJson!);
            Assert.Equal(
                ReservationRejectionReasons.OwnerApprovalTimeout,
                metadata.RootElement.GetProperty("rejectionReason").GetString());
        });
    }

    private static KoochDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"reservation-notification-{Guid.NewGuid():N}")
            .Options;
        return new KoochDbContext(options);
    }

    private static ReservationApprovalReminderService CreateReminderService(KoochDbContext context)
    {
        var authorization = CreateAuthorization();
        var resolver = new ReservationNotificationRecipientResolver(
            context,
            new StubPermissionService([6]),
            authorization);
        var dispatcher = new ReservationNotificationDispatcher(
            context,
            new NotificationService(context),
            resolver);
        return new ReservationApprovalReminderService(context, dispatcher);
    }

    private static ReservationNotificationDispatcher CreateDispatcher(KoochDbContext context)
    {
        var authorization = CreateAuthorization();
        var resolver = new ReservationNotificationRecipientResolver(
            context,
            new StubPermissionService([6]),
            authorization);
        return new ReservationNotificationDispatcher(
            context,
            new NotificationService(context),
            resolver);
    }

    private static void AddReminderSetting(KoochDbContext context, int minutes) =>
        context.SiteSettings.Add(new SiteSetting
        {
            Key = ReservationOwnerApprovalReminderSettings.SettingKey,
            Value = minutes.ToString(System.Globalization.CultureInfo.InvariantCulture),
            Type = SiteSettingType.Number,
            Group = "Reservation",
            Label = "Reminder interval",
            IsActive = true
        });

    private static void AddReservation(
        KoochDbContext context,
        int id,
        ReservationStatus status,
        DateTime approvalExpiresAtUtc) =>
        context.Reservations.Add(new Reservation
        {
            Id = id,
            ReservationNumber = $"KCH-REQUEST-{id}",
            ClientId = 20,
            PropertyId = 10,
            RoomTypeId = 30,
            CheckInDate = new DateOnly(2035, 1, 1),
            CheckOutDate = new DateOnly(2035, 1, 3),
            AdultCount = 2,
            Currency = "IRR",
            Status = status,
            Source = ReservationSource.Website,
            ApprovalExpiresAtUtc = approvalExpiresAtUtc
        });

    private static Task<List<NotificationLog>> ReminderLogs(KoochDbContext context, int reservationId) =>
        context.NotificationLogs.AsNoTracking()
            .Where(log =>
                log.ReservationId == reservationId &&
                log.EventType == NotificationEventType.ReservationApprovalReminder)
            .OrderBy(log => log.Id)
            .ToListAsync();

    private static void SeedRecipients(KoochDbContext context, bool includeAssignment)
    {
        context.Users.AddRange(
            CreateUser(1, UserRole.Owner),
            CreateUser(2, UserRole.OwnerAssistant),
            CreateUser(3, UserRole.OwnerAssistant),
            CreateUser(4, UserRole.OwnerAssistant, isActive: false),
            CreateUser(5, UserRole.OwnerAssistant, isDeleted: true),
            CreateUser(6, UserRole.AdminAssistant),
            CreateUser(20, UserRole.Client, mobile: "09120000020", email: "guest@example.test"));
        context.Properties.Add(new Property
        {
            Id = 10,
            OwnerId = 1,
            DestinationId = 1,
            Name = "Test Property",
            Slug = "test-property",
            Description = "Test",
            Address = "Test",
            City = "Test",
            Country = "IR"
        });
        context.UserPropertyAccesses.AddRange(
            CreateMembership(1, 1),
            CreateMembership(2, 2),
            CreateMembership(3, 3),
            CreateMembership(4, 4),
            CreateMembership(5, 5));
        if (includeAssignment)
        {
            context.PropertyReservationFollowUpRecipients.Add(new PropertyReservationFollowUpRecipient
            {
                PropertyId = 10,
                UserId = 6,
                IsActive = true
            });
        }
    }

    private static User CreateUser(
        int id,
        UserRole role,
        bool isActive = true,
        bool isDeleted = false,
        string? mobile = null,
        string? email = null) => new()
        {
            Id = id,
            FirstName = $"User{id}",
            LastName = "Test",
            PasswordHash = "test",
            PhoneNumber = mobile,
            Email = email,
            Role = role,
            IsActive = isActive,
            IsDeleted = isDeleted
        };

    private static UserPropertyAccess CreateMembership(int id, int userId) => new()
    {
        Id = id,
        UserId = userId,
        PropertyId = 10,
        Status = PropertyUserStatus.Active,
        PropertyRole = userId == 1 ? PropertyUserRole.PropertyOwner : PropertyUserRole.Manager,
        PermissionMatrixJson = "{}",
        IsActive = true
    };

    private static StubPropertyAuthorizationService CreateAuthorization()
    {
        var service = new StubPropertyAuthorizationService();
        foreach (var userId in new[] { 1, 2, 4, 5, 6 })
        {
            service.Allow(userId, 10, "bookings.edit");
        }

        return service;
    }

    private sealed class StubPermissionService(IEnumerable<int> reservationManagers) : IPermissionService
    {
        private readonly HashSet<int> reservationManagers = reservationManagers.ToHashSet();

        public Task<bool> CanAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(false);

        public Task<bool> HasPermissionAsync(
            int userId,
            PermissionKey permissionKey,
            int? propertyId = null,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(
                permissionKey == PermissionKey.ManageReservations && reservationManagers.Contains(userId));
    }

    private sealed class StubPropertyAuthorizationService : IPropertyAuthorizationService
    {
        private readonly HashSet<(int UserId, int PropertyId, string Permission)> allowed = [];

        public void Allow(int userId, int propertyId, string permission) =>
            allowed.Add((userId, propertyId, permission));

        public Task<bool> CanAccessPropertyAsync(
            int userId,
            int propertyId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(allowed.Any(item => item.UserId == userId && item.PropertyId == propertyId));

        public Task<bool> CanAccessOwnerPanelAsync(
            int userId,
            CancellationToken cancellationToken = default) => Task.FromResult(false);

        public Task<bool> HasPropertyPermissionAsync(
            int userId,
            int propertyId,
            string permissionKey,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(allowed.Contains((userId, propertyId, permissionKey)));

        public Task<EffectivePropertyPermissions?> GetEffectivePropertyPermissionsAsync(
            int userId,
            int propertyId,
            CancellationToken cancellationToken = default) => Task.FromResult<EffectivePropertyPermissions?>(null);

        public Task<IReadOnlyList<int>> GetAccessiblePropertiesAsync(
            int userId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<int>>([]);
    }
}

internal sealed class ExpirationWinningDispatcher(
    KoochDbContext dbContext,
    IReservationNotificationDispatcher inner) : IReservationNotificationDispatcher
{
    public Task NotifyPendingApprovalAsync(
        IReadOnlyCollection<int> reservationIds,
        CancellationToken cancellationToken = default) =>
        inner.NotifyPendingApprovalAsync(reservationIds, cancellationToken);

    public Task NotifyOwnerApprovalTimeoutAsync(
        int reservationId,
        CancellationToken cancellationToken = default) =>
        inner.NotifyOwnerApprovalTimeoutAsync(reservationId, cancellationToken);

    public async Task<bool> NotifyApprovalReminderAsync(
        int reservationId,
        DateTime nowUtc,
        string occurrenceKey,
        CancellationToken cancellationToken = default)
    {
        var reservation = await dbContext.Reservations.SingleAsync(
            item => item.Id == reservationId,
            cancellationToken);
        reservation.Status = ReservationStatus.Rejected;
        reservation.ExpiredAtUtc = nowUtc;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await inner.NotifyApprovalReminderAsync(
            reservationId,
            nowUtc,
            occurrenceKey,
            cancellationToken);
    }
}
