using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Dtos.Settlements;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SettlementTests
{
    private static readonly DateOnly Today = new(2026, 9, 27);
    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 9, 27, 0, 0, 0, TimeSpan.Zero);
    }

    private static KoochDbContext Context()
    {
        var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        context.Properties.AddRange(new Property { Id = 1, Name = "First", Slug = "first" },
            new Property { Id = 2, Name = "Second", Slug = "second" });
        context.SaveChanges();
        return context;
    }

    private static FinancialEntry Payable(int id, int property = 1, string currency = "IRR", int days = 0) => new()
    {
        Id = id, PropertyId = property, ReservationId = id, EntryType = FinancialEntryType.PropertyPayable,
        Amount = 123.45m, Currency = currency, PayableDueDate = Today.AddDays(days),
        EffectiveAtUtc = DateTime.UtcNow, CorrelationKey = $"payable:{id}"
    };

    [Theory]
    [InlineData("CheckIn", -2, 8)]
    [InlineData("CheckIn", 0, 10)]
    [InlineData("CheckIn", 3, 13)]
    [InlineData("CheckOut", -2, 12)]
    [InlineData("CheckOut", 0, 14)]
    [InlineData("CheckOut", 3, 17)]
    public async Task GlobalPolicy_UsesBaseAndSignedOffsetForEveryProperty(string basis, int offset, int day)
    {
        await using var context = Context();
        context.SiteSettings.AddRange(new SiteSetting { Key = SettlementPolicy.BaseDateKey, Value = basis },
            new SiteSetting { Key = SettlementPolicy.OffsetDaysKey, Value = offset.ToString() });
        await context.SaveChangesAsync();
        foreach (var property in new[] { 1, 2 })
        {
            var reservation = new Reservation { PropertyId = property,
                CheckInDate = new(2026, 9, 10), CheckOutDate = new(2026, 9, 14) };
            Assert.Equal(new DateOnly(2026, 9, day), await SettlementPolicy.CalculateDueDateAsync(context, reservation));
        }
    }

    [Fact]
    public async Task PayableDate_IsSnapshottedAndPolicyChangesOnlyAffectNewEntries()
    {
        await using var context = Context();
        context.SiteSettings.Add(new SiteSetting { Key = CommissionPolicyResolver.DirectSettingKey, Value = "10" });
        await context.SaveChangesAsync();
        var service = new PaymentFinancializationService(context, new CommissionPolicyResolver(context));
        var reservation = new Reservation { Id = 1, PropertyId = 1, CheckInDate = Today, CheckOutDate = Today.AddDays(4) };
        var payment = new Payment { Id = 1, ReservationId = 1, Currency = "IRR", Amount = 100m };
        await service.ApplyAsync(reservation, payment, null, 100m, DateTime.UtcNow);
        await context.SaveChangesAsync();
        var original = await context.FinancialEntries.SingleAsync();
        Assert.Equal(reservation.CheckOutDate, original.PayableDueDate);
        context.SiteSettings.AddRange(new SiteSetting { Key = SettlementPolicy.BaseDateKey, Value = "CheckIn" },
            new SiteSetting { Key = SettlementPolicy.OffsetDaysKey, Value = "-2" });
        await context.SaveChangesAsync();
        await service.ApplyAsync(reservation, payment, null, 100m, DateTime.UtcNow);
        await context.SaveChangesAsync();
        Assert.Equal(Today.AddDays(4), (await context.FinancialEntries.SingleAsync()).PayableDueDate);
        reservation = new Reservation { Id = 2, PropertyId = 1, CheckInDate = Today, CheckOutDate = Today.AddDays(4) };
        payment = new Payment { Id = 2, ReservationId = 2, Currency = "IRR", Amount = 100m };
        await service.ApplyAsync(reservation, payment, null, 100m, DateTime.UtcNow);
        await context.SaveChangesAsync();
        Assert.Equal(Today.AddDays(-2), (await context.FinancialEntries.SingleAsync(entry => entry.ReservationId == 2)).PayableDueDate);
    }

    [Fact]
    public async Task Settlement_GroupsDuePayablesPreservingAmountsDatesAndHistory()
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1, days: -3), Payable(2));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1, 2]);
        Assert.Equal(246.90m, settlement.TotalAmount);
        Assert.Equal("IRR", settlement.Currency);
        Assert.Equal(2, settlement.Items.Count);
        Assert.Equal(SettlementStatus.Overdue, settlement.GetStatus(Today));
        Assert.Equal(Today.AddDays(-3), settlement.Items.Single(item => item.FinancialEntryId == 1).FinancialEntry.PayableDueDate);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, [1]));
        var paid = await service.MarkPaidAsync(settlement.Id);
        Assert.Equal(new Clock().GetUtcNow().UtcDateTime, paid.PaidAtUtc);
        Assert.Equal(SettlementStatus.Paid, paid.GetStatus(Today));
        Assert.Equal(paid.PaidAtUtc, (await service.MarkPaidAsync(paid.Id)).PaidAtUtc);
        Assert.Equal(2, await context.FinancialEntries.CountAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, [2]));
    }

    [Theory]
    [InlineData(2, "IRR")]
    [InlineData(1, "USD")]
    public async Task MixedPropertyOrCurrency_IsRejected(int property, string currency)
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1), Payable(2, property, currency));
        await context.SaveChangesAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => new SettlementService(context, new Clock()).CreateAsync(1, [1, 2]));
        Assert.Empty(context.Settlements);
    }

    [Fact]
    public async Task FuturePayable_RequiresExplicitEarlyIntentAndKeepsDueDateWhenPaid()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1, days: 3));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, [1]));
        var settlement = await service.CreateAsync(1, [1], allowEarlySettlement: true);
        Assert.True(settlement.IsEarlySettlement);
        Assert.Equal(SettlementStatus.Pending, settlement.GetStatus(Today));
        Assert.Equal(SettlementStatus.Due, settlement.GetStatus(Today.AddDays(3)));
        Assert.Equal(SettlementStatus.Overdue, settlement.GetStatus(Today.AddDays(4)));
        await service.MarkPaidAsync(settlement.Id);
        Assert.Equal(Today.AddDays(3), settlement.Items.Single().FinancialEntry.PayableDueDate);
        Assert.True(DateOnly.FromDateTime(settlement.PaidAtUtc!.Value) < Today.AddDays(3));
    }

    [Fact]
    public async Task UniqueIndex_RejectsDuplicateAcrossContexts_AndLinksAreImmutable()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new KoochDbContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var settlement = await new SettlementService(context, new Clock()).CreateAsync(1, [1]);
        var listed = await new SettlementService(context, new Clock()).ListAsync(new SettlementListQuery());
        Assert.Equal(SettlementStatus.Due, Assert.Single(listed.Items).Status);
        Assert.Empty((await new SettlementService(context, new Clock()).ListPayablesAsync(new SettlementListQuery())).Items);
        await using (var competing = new KoochDbContext(options))
        {
            competing.Settlements.Add(new Settlement { PropertyId = 1, Currency = "IRR", TotalAmount = 123.45m,
                Items = [new SettlementItem { FinancialEntryId = 1 }] });
            await Assert.ThrowsAsync<DbUpdateException>(() => competing.SaveChangesAsync());
        }
        Assert.Single(await context.Settlements.ToListAsync());
        await using (var competing = new KoochDbContext(options))
        {
            var service = new SettlementService(competing, new Clock());
            await service.GetAsync(settlement.Id);
            var paid = await new SettlementService(context, new Clock()).MarkPaidAsync(settlement.Id);
            var concurrentPaid = await service.MarkPaidAsync(settlement.Id);
            Assert.Equal(paid.PaidAtUtc, concurrentPaid.PaidAtUtc);
        }
        context.SettlementItems.Remove(settlement.Items.Single());
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task AdminLists_PageUnsettledEntriesAndPreserveServerStatuses()
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1, days: -1), Payable(2), Payable(3, days: 1), Payable(4, property: 2));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var first = await service.ListPayablesAsync(new SettlementListQuery { PropertyId = 1, PageSize = 2 });
        Assert.Equal(3, first.TotalCount);
        Assert.Equal(2, first.TotalPages);
        Assert.Equal(new[] { PayableStatus.Overdue, PayableStatus.Due }, first.Items.Select(item => item.Status));
        var second = await service.ListPayablesAsync(new SettlementListQuery { PropertyId = 1, PageSize = 2, Page = 2 });
        Assert.Equal(PayableStatus.Future, Assert.Single(second.Items).Status);
        var batch = await service.CreateAsync(1, [1, 2]);
        await service.MarkPaidAsync(batch.Id);
        var remaining = await service.ListPayablesAsync(new SettlementListQuery { PropertyId = 1 });
        Assert.Equal(3, Assert.Single(remaining.Items).Id);
        var list = Assert.Single((await service.ListAsync(new SettlementListQuery { PropertyId = 1 })).Items);
        Assert.Equal("First", list.PropertyName);
        Assert.Equal(2, list.ItemCount);
        Assert.Equal(SettlementStatus.Paid, list.Status);
        Assert.Equal(246.90m, list.TotalAmount);
        Assert.Equal("Second", Assert.Single((await service.ListPropertiesAsync(new SettlementListQuery { Search = " Second " })).Items).Name);
    }

    [Theory]
    [InlineData("settlement.baseDate", "Invalid")]
    [InlineData("settlement.offsetDays", "1.5")]
    [InlineData("settlement.offsetDays", "2147483648")]
    public void InvalidPolicy_IsRejected(string key, string value) =>
        Assert.Throws<ArgumentException>(() => SettlementPolicy.ValidateSetting(key, value));

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(3)]
    public async Task Cancellation_PreservesHistoryReleasesAllItemsAndAllowsNewBatch(int dueDays)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new KoochDbContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.FinancialEntries.AddRange(Payable(1, days: dueDays), Payable(2, days: dueDays));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var batch = await service.CreateAsync(1, [1, 2], allowEarlySettlement: dueDays > 0);
        var cancelled = await service.CancelAsync(batch.Id, "  Correction requested  ", actorId: 7);
        Assert.Equal(SettlementStatus.Cancelled, cancelled.GetStatus(Today));
        Assert.Equal("Correction requested", cancelled.CancellationReason);
        Assert.Equal(7, cancelled.CancelledByUserId);
        Assert.Equal(new Clock().GetUtcNow().UtcDateTime, cancelled.CancelledAtUtc);
        Assert.Null(cancelled.PaidAtUtc);
        Assert.All(cancelled.Items, item => Assert.Equal(cancelled.CancelledAtUtc, item.ReleasedAtUtc));
        Assert.Equal(2, (await service.ListPayablesAsync(new SettlementListQuery())).TotalCount);
        Assert.Equal(SettlementStatus.Cancelled, Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(batch.Id, "Again"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.MarkPaidAsync(batch.Id));

        var replacement = await service.CreateAsync(1, [1, 2], allowEarlySettlement: dueDays > 0);
        Assert.NotEqual(cancelled.Id, replacement.Id);
        Assert.Equal(cancelled.TotalAmount, replacement.TotalAmount);
        Assert.Equal(cancelled.Currency, replacement.Currency);
        Assert.Equal(cancelled.PropertyId, replacement.PropertyId);
        Assert.Equal(4, await context.SettlementItems.CountAsync());
        Assert.Equal(2, await context.Settlements.CountAsync());
        Assert.Equal(2, await context.FinancialEntries.CountAsync());
        Assert.All(await context.FinancialEntries.ToListAsync(), entry =>
        {
            Assert.Equal(123.45m, entry.Amount);
            Assert.Equal(Today.AddDays(dueDays), entry.PayableDueDate);
        });
        await using var competing = new KoochDbContext(options);
        competing.Settlements.Add(new Settlement { PropertyId = 1, Currency = "IRR", TotalAmount = 123.45m,
            Items = [new SettlementItem { FinancialEntryId = 1 }] });
        await Assert.ThrowsAsync<DbUpdateException>(() => competing.SaveChangesAsync());
        cancelled.Items.First().ReleasedAtUtc = null;
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task Cancellation_RejectsBlankReasonAndPaidSettlement()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var batch = await service.CreateAsync(1, [1]);
        await Assert.ThrowsAsync<ArgumentException>(() => service.CancelAsync(batch.Id, "  "));
        Assert.Null(batch.CancelledAtUtc);
        Assert.Null(batch.Items.Single().ReleasedAtUtc);
        await service.MarkPaidAsync(batch.Id);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(batch.Id, "Correction"));
        Assert.Null(batch.CancelledAtUtc);
        Assert.Null(batch.Items.Single().ReleasedAtUtc);
        Assert.Empty((await service.ListPayablesAsync(new SettlementListQuery())).Items);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CancellationAndPayment_FromConcurrentSnapshots_OnlyOneWins(bool cancellationWins)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var first = new KoochDbContext(options);
        await first.Database.EnsureCreatedAsync();
        first.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        first.FinancialEntries.AddRange(Payable(1), Payable(2));
        await first.SaveChangesAsync();
        var firstService = new SettlementService(first, new Clock());
        var batch = await firstService.CreateAsync(1, [1, 2]);
        await using var second = new KoochDbContext(options);
        var secondService = new SettlementService(second, new Clock());
        await secondService.GetAsync(batch.Id);
        if (cancellationWins)
        {
            await firstService.CancelAsync(batch.Id, "Correction", 7);
            await Assert.ThrowsAsync<InvalidOperationException>(() => secondService.MarkPaidAsync(batch.Id));
        }
        else
        {
            await firstService.MarkPaidAsync(batch.Id);
            await Assert.ThrowsAsync<InvalidOperationException>(() => secondService.CancelAsync(batch.Id, "Correction", 7));
        }
        await using var verify = new KoochDbContext(options);
        var saved = await new SettlementService(verify, new Clock()).GetAsync(batch.Id);
        Assert.Equal(cancellationWins, saved.CancelledAtUtc.HasValue);
        Assert.Equal(!cancellationWins, saved.PaidAtUtc.HasValue);
        Assert.All(saved.Items, item => Assert.Equal(cancellationWins, item.ReleasedAtUtc.HasValue));
        Assert.Equal(cancellationWins ? "Correction" : null, saved.CancellationReason);
        Assert.Equal(2, await verify.FinancialEntries.CountAsync());
    }

    [Theory]
    [InlineData(FinancialEntryType.Commission, true)]
    [InlineData(FinancialEntryType.PropertyPayable, false)]
    public async Task NonPayableOrMissingDate_IsRejected(FinancialEntryType type, bool hasDueDate)
    {
        await using var context = Context();
        var entry = Payable(1);
        entry.EntryType = type;
        if (!hasDueDate) entry.PayableDueDate = null;
        context.FinancialEntries.Add(entry);
        await context.SaveChangesAsync();
        await Assert.ThrowsAsync<ArgumentException>(() => new SettlementService(context, new Clock()).CreateAsync(1, [1]));
    }
}
