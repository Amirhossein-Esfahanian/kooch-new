using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Dtos.Settlements;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Kooch.Api.Migrations;
using Kooch.Api.Controllers;
using Kooch.Api.Authentication;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class SettlementTests
{
    private sealed class ReceiptPermission(bool allowed) : IPermissionService
    {
        public Task<bool> CanAsync(int userId, int propertyId, string permissionKey,
            CancellationToken cancellationToken = default) => Task.FromResult(allowed && permissionKey == "financial.view");
        public Task<bool> HasPermissionAsync(int userId, PermissionKey permissionKey, int? propertyId = null,
            CancellationToken cancellationToken = default) => Task.FromResult(false);
    }

    [Fact]
    public async Task PaidReceipt_UsesOnlyHistoricalFacts_AndDistinctAudienceContracts()
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1), Payable(2));
        context.UserPropertyAccesses.Add(new UserPropertyAccess { UserId = 20, PropertyId = 1, IsActive = true,
            Status = PropertyUserStatus.Active });
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1, 2]);
        await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        var originalNumber = settlement.SettlementNumber;
        (await context.Properties.SingleAsync(item => item.Id == 1)).Name = "Renamed property";
        (await context.Reservations.SingleAsync(item => item.Id == 1)).ReservationNumber = "R-999999";
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var receipts = new SettlementReceiptQueryService(context, new ReceiptPermission(true));
        var action = await new AdminSettlementReceiptsController(receipts).Get(originalNumber, default);
        var admin = Assert.IsType<AdminSettlementReceiptResponse>(Assert.IsType<OkObjectResult>(action.Result).Value);
        var owner = await receipts.GetForPropertyAsync(20, 1, originalNumber);
        Assert.Matches("^S-[1-9][0-9]{5}$", admin.SettlementNumber);
        Assert.Equal("First", admin.PropertyName);
        Assert.Equal("First", owner.PropertyName);
        Assert.Equal("IRR", admin.Currency);
        Assert.Equal("IRR", owner.Currency);
        Assert.Equal(246.90m, admin.TotalAmount);
        Assert.Equal(PaymentRequest().PaidAtUtc!.Value.UtcDateTime, admin.PaidAtUtc);
        Assert.Equal("0087453219", admin.ReferenceNumber);
        Assert.Equal("manual settlement", admin.Note);
        Assert.Equal(new Clock().GetUtcNow().UtcDateTime, admin.RecordedAtUtc);
        Assert.Equal(2, admin.ItemCount);
        Assert.All(admin.Items, item =>
        {
            Assert.Matches("^R-[0-9]{6}$", item.ReservationNumber);
            Assert.Equal(Today, item.PayableDueDate);
            Assert.Equal(123.45m, item.Amount);
        });
        Assert.Contains(admin.Items, item => item.ReservationNumber == "R-100001");
        Assert.DoesNotContain(admin.Items, item => item.ReservationNumber == "R-999999");
        Assert.Equal(admin.Items, owner.Items);
        Assert.Null(typeof(PropertySettlementReceiptResponse).GetProperty(nameof(AdminSettlementReceiptResponse.Note)));
        Assert.Null(typeof(PropertySettlementReceiptResponse).GetProperty(nameof(AdminSettlementReceiptResponse.RecordedAtUtc)));
        Assert.Null(typeof(PropertySettlementReceiptResponse).GetProperty("RecordedByUserId"));
        Assert.Null(typeof(PropertySettlementReceiptResponse).GetProperty("SettlementId"));
        Assert.Null(typeof(PropertySettlementReceiptResponse).GetProperty("FinancialEntryId"));
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(AdminSettlementReceiptsController), typeof(AdminAuthorizeAttribute)));
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(AdminSettlementReceiptsController), typeof(PermissionAuthorizeAttribute)));
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(OwnerSettlementReceiptsController), typeof(OwnerAuthorizeAttribute)));
    }

    [Fact]
    public async Task PropertyReceipt_RequiresOwnActiveMembershipAndFinancialView()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        context.UserPropertyAccesses.AddRange(
            new UserPropertyAccess { UserId = 20, PropertyId = 1, IsActive = true, Status = PropertyUserStatus.Active },
            new UserPropertyAccess { UserId = 21, PropertyId = 2, IsActive = true, Status = PropertyUserStatus.Active },
            new UserPropertyAccess { UserId = 22, PropertyId = 1, IsActive = false, Status = PropertyUserStatus.Active });
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        var allowed = new SettlementReceiptQueryService(context, new ReceiptPermission(true));
        Assert.Equal(settlement.SettlementNumber,
            (await allowed.GetForPropertyAsync(20, 1, settlement.SettlementNumber)).SettlementNumber);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            allowed.GetForPropertyAsync(21, 1, settlement.SettlementNumber));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            allowed.GetForPropertyAsync(22, 1, settlement.SettlementNumber));
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            new SettlementReceiptQueryService(context, new ReceiptPermission(false))
                .GetForPropertyAsync(20, 1, settlement.SettlementNumber));
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            allowed.GetForPropertyAsync(21, 2, settlement.SettlementNumber));
    }

    [Fact]
    public async Task ReceiptIsUnavailableUntilPaidAndWhenHistoricalFieldsAreMissing()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new ReadQueryContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Reservations.Add(ReservationFor(1));
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        var receipts = new SettlementReceiptQueryService(context, new ReceiptPermission(true));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => receipts.GetForAdminAsync(settlement.SettlementNumber));
        Assert.False(Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).CanViewReceipt);
        await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        Assert.True(Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).CanViewReceipt);
        await context.Database.ExecuteSqlRawAsync(
            "UPDATE SettlementPaymentRecords SET PropertyNameSnapshot = NULL WHERE SettlementId = {0}", settlement.Id);
        context.ChangeTracker.Clear();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => receipts.GetForAdminAsync(settlement.SettlementNumber));
        Assert.False(Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).CanViewReceipt);
        await context.Database.ExecuteSqlRawAsync(
            "UPDATE SettlementPaymentRecords SET PropertyNameSnapshot = 'First' WHERE SettlementId = {0}", settlement.Id);
        await context.Database.ExecuteSqlRawAsync(
            "UPDATE SettlementItems SET ReservationNumberSnapshot = NULL WHERE SettlementId = {0}", settlement.Id);
        context.ChangeTracker.Clear();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => receipts.GetForAdminAsync(settlement.SettlementNumber));
        Assert.False(Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).CanViewReceipt);
        await context.Database.ExecuteSqlRawAsync(
            "UPDATE SettlementItems SET ReservationNumberSnapshot = 'R-100001' WHERE SettlementId = {0}", settlement.Id);
        await context.Database.ExecuteSqlRawAsync(
            "DELETE FROM SettlementPaymentRecords WHERE SettlementId = {0}", settlement.Id);
        context.ChangeTracker.Clear();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => receipts.GetForAdminAsync(settlement.SettlementNumber));
        Assert.False(Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).CanViewReceipt);
    }

    [Fact]
    public async Task CancelledSettlementCannotHaveReceipt()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        await service.CancelAsync(settlement.Id, "test", 77);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            new SettlementReceiptQueryService(context, new ReceiptPermission(true))
                .GetForAdminAsync(settlement.SettlementNumber));
        Assert.False(Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).CanViewReceipt);
    }

    private static MarkSettlementPaidRequest PaymentRequest(DateTimeOffset? paidAtUtc = null) => new()
    {
        PaymentMethod = SettlementPaymentMethod.BankTransfer,
        ReferenceNumber = "  0087453219  ",
        PaidAtUtc = paidAtUtc ?? new DateTimeOffset(2026, 9, 27, 15, 45, 0, TimeSpan.FromHours(3.5)),
        Note = "  manual settlement  "
    };
    private sealed class NumberSequence(KoochDbContext context, params int[] numbers) : SettlementNumberGenerator(context)
    {
        private readonly Queue<int> values = new(numbers);
        protected override int NextNumber() => values.Dequeue();
    }

    [Fact]
    public async Task NewSettlement_UsesSixDigitPublicReferenceFromProductionGenerator()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var settlement = await new SettlementService(context, new Clock()).CreateAsync(1, [1]);
        Assert.Matches("^S-[1-9][0-9]{5}$", settlement.SettlementNumber);
        Assert.InRange(int.Parse(settlement.SettlementNumber[2..]), 100000, 999999);
    }

    [Fact]
    public async Task NewSettlementItem_SnapshotsTrimmedReservationNumber_AndIgnoresLaterRename()
    {
        await using var context = Context();
        var reservation = await context.Reservations.SingleAsync(item => item.Id == 1);
        reservation.ReservationNumber = "  R-583214  ";
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());

        Assert.Null(typeof(CreateSettlementRequest).GetProperty(nameof(SettlementItem.ReservationNumberSnapshot)));
        var settlement = await service.CreateAsync(1, [1]);
        Assert.Equal("R-583214", Assert.Single(settlement.Items).ReservationNumberSnapshot);

        reservation.ReservationNumber = "R-271946";
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var loaded = await service.GetAsync(settlement.Id);
        Assert.Equal("R-583214", Assert.Single(loaded.Items).ReservationNumberSnapshot);
        var result = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(settlement.Id, default)).Result);
        Assert.Equal("R-583214", Assert.Single(Assert.IsType<SettlementResponse>(result.Value).Items).ReservationNumber);
    }

    [Fact]
    public async Task MissingReservationNumber_RejectsSettlementWithoutAllocatingPayable()
    {
        await using var context = Context();
        (await context.Reservations.SingleAsync(item => item.Id == 1)).ReservationNumber = null;
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => new SettlementService(context, new Clock()).CreateAsync(1, [1]));
        Assert.Empty(await context.Settlements.ToListAsync());
        Assert.Empty(await context.SettlementItems.ToListAsync());
        Assert.Single((await new SettlementService(context, new Clock()).ListPayablesAsync(new SettlementListQuery())).Items);
    }

    [Fact]
    public async Task SettlementItemSnapshot_CannotBeChangedAfterCreation()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var settlement = await new SettlementService(context, new Clock()).CreateAsync(1, [1]);

        Assert.Single(settlement.Items).ReservationNumberSnapshot = "R-999999";
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task LegacySettlementItemWithoutSnapshot_RemainsReadableWithoutLiveFallback()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new ReadQueryContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Reservations.Add(ReservationFor(1));
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        await context.Database.ExecuteSqlRawAsync(
            "UPDATE SettlementItems SET ReservationNumberSnapshot = NULL WHERE SettlementId = {0}", settlement.Id);
        context.ChangeTracker.Clear();

        var loaded = await service.GetAsync(settlement.Id);
        Assert.Null(Assert.Single(loaded.Items).ReservationNumberSnapshot);
        var result = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(settlement.Id, default)).Result);
        Assert.Null(Assert.Single(Assert.IsType<SettlementResponse>(result.Value).Items).ReservationNumber);
    }

    [Fact]
    public async Task InvalidPaymentFacts_DoNotChangeSettlementOrCreateRecord()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        var longReference = PaymentRequest();
        longReference.ReferenceNumber = new string('x', 201);
        var longNote = PaymentRequest();
        longNote.Note = new string('x', 2001);
        var invalidRequests = new[]
        {
            new MarkSettlementPaidRequest { ReferenceNumber = "ref", PaidAtUtc = PaymentRequest().PaidAtUtc },
            new MarkSettlementPaidRequest { PaymentMethod = SettlementPaymentMethod.BankTransfer, ReferenceNumber = "  ", PaidAtUtc = PaymentRequest().PaidAtUtc },
            new MarkSettlementPaidRequest { PaymentMethod = SettlementPaymentMethod.BankTransfer, ReferenceNumber = "ref", PaidAtUtc = default },
            new MarkSettlementPaidRequest { PaymentMethod = (SettlementPaymentMethod)99, ReferenceNumber = "ref", PaidAtUtc = PaymentRequest().PaidAtUtc },
            longReference,
            longNote,
        };
        foreach (var request in invalidRequests)
            await Assert.ThrowsAsync<ArgumentException>(() => service.MarkPaidAsync(settlement.Id, request, 77));
        Assert.Null(settlement.PaidAtUtc);
        Assert.Empty(await context.SettlementPaymentRecords.ToListAsync());
        settlement.PaidAtUtc = PaymentRequest().PaidAtUtc!.Value.UtcDateTime;
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task PaymentRecordInsertFailure_RollsBackPaidTransition()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new ReadQueryContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Reservations.Add(ReservationFor(1));
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        await context.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER RejectSettlementPaymentRecord BEFORE INSERT ON SettlementPaymentRecords
            BEGIN SELECT RAISE(ABORT, 'test payment record failure'); END;
            """);

        await Assert.ThrowsAsync<DbUpdateException>(() => service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77));
        await context.Entry(settlement).ReloadAsync();
        Assert.Null(settlement.PaidAtUtc);
        Assert.Equal(0, await context.SettlementPaymentRecords.AsNoTracking().CountAsync());
    }

    [Fact]
    public async Task MarkPaid_CapturesPropertyNameWithoutClientInput_AndRenameDoesNotChangeSnapshot()
    {
        await using var context = Context();
        var property = await context.Properties.SingleAsync(item => item.Id == 1);
        property.Name = "  Original property  ";
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);

        Assert.Null(typeof(MarkSettlementPaidRequest).GetProperty(nameof(SettlementPaymentRecord.PropertyNameSnapshot)));
        var paid = await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        Assert.Equal("Original property", paid.PaymentRecord!.PropertyNameSnapshot);
        Assert.Equal(paid.PaidAtUtc, paid.PaymentRecord.PaidAtUtc);

        property.Name = "Renamed property";
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var loaded = await service.GetAsync(settlement.Id);
        Assert.Equal("Renamed property", loaded.Property.Name);
        Assert.Equal("Original property", loaded.PaymentRecord!.PropertyNameSnapshot);
        var result = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(settlement.Id, default)).Result);
        Assert.Equal("Original property", Assert.IsType<SettlementResponse>(result.Value).PaymentRecord!.PropertyNameSnapshot);
    }

    [Fact]
    public async Task MarkPaid_RejectsBlankPropertyNameWithoutChangingSettlement()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        settlement.Property.Name = "   ";

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77));
        Assert.Null(settlement.PaidAtUtc);
        Assert.Empty(await context.SettlementPaymentRecords.ToListAsync());
    }

    [Fact]
    public async Task PropertyNameSnapshot_IsImmutableAfterPayment()
    {
        await using var context = Context();
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        var paid = await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);

        paid.PaymentRecord!.PropertyNameSnapshot = "Changed";
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task LegacyPaymentRecordWithoutPropertyNameSnapshot_RemainsReadable()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new ReadQueryContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Reservations.Add(ReservationFor(1));
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var settlement = await service.CreateAsync(1, [1]);
        await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        await context.Database.ExecuteSqlRawAsync(
            "UPDATE SettlementPaymentRecords SET PropertyNameSnapshot = NULL WHERE SettlementId = {0}", settlement.Id);
        context.ChangeTracker.Clear();

        var loaded = await service.GetAsync(settlement.Id);
        Assert.NotNull(loaded.PaymentRecord);
        Assert.Null(loaded.PaymentRecord.PropertyNameSnapshot);
        var result = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(settlement.Id, default)).Result);
        Assert.Null(Assert.IsType<SettlementResponse>(result.Value).PaymentRecord!.PropertyNameSnapshot);
    }

    [Fact]
    public async Task HistoricalPaidSettlementWithoutRecord_IsReadableAndOneToOneIndexExists()
    {
        await using var context = Context();
        var settlement = new Settlement
        {
            Id = 50, PropertyId = 1, SettlementNumber = "S-583214", Currency = "IRR", TotalAmount = 1m,
            PaidAtUtc = new DateTime(2026, 9, 27, 10, 0, 0, DateTimeKind.Utc)
        };
        context.Settlements.Add(settlement);
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var result = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(50, default)).Result);
        var response = Assert.IsType<SettlementResponse>(result.Value);
        Assert.Null(response.PaymentRecord);
        var index = context.Model.FindEntityType(typeof(SettlementPaymentRecord))!.GetIndexes()
            .Single(item => item.Properties.Single().Name == nameof(SettlementPaymentRecord.SettlementId));
        Assert.True(index.IsUnique);
    }

    [Fact]
    public async Task PublicReference_IsOpaqueUniqueAndRetriesExistingCandidate()
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1), Payable(2));
        await context.SaveChangesAsync();
        var generator = new NumberSequence(context, 583214, 583214, 271946);
        var service = new SettlementService(context, new Clock(), generator);
        var first = await service.CreateAsync(1, [1]);
        var second = await service.CreateAsync(1, [2]);
        Assert.Equal("S-583214", first.SettlementNumber);
        Assert.Equal("S-271946", second.SettlementNumber);
        Assert.Matches("^S-[1-9][0-9]{5}$", second.SettlementNumber);
        Assert.NotEqual(first.Id, int.Parse(first.SettlementNumber[2..]));
        var listed = (await service.ListAsync(new SettlementListQuery())).Items;
        Assert.Contains(listed, item => item.Id == first.Id && item.SettlementNumber == first.SettlementNumber);
        var response = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(first.Id, default)).Result);
        Assert.Equal(first.SettlementNumber, Assert.IsType<SettlementResponse>(response.Value).SettlementNumber);
        var paid = await service.MarkPaidAsync(first.Id, PaymentRequest(), 77);
        Assert.Equal("S-583214", paid.SettlementNumber);
        var paidResponseResult = Assert.IsType<OkObjectResult>((await new AdminSettlementsController(service).Get(first.Id, default)).Result);
        var paidResponse = Assert.IsType<SettlementResponse>(paidResponseResult.Value);
        Assert.Equal(SettlementPaymentMethod.BankTransfer, paidResponse.PaymentRecord!.PaymentMethod);
        Assert.Equal("0087453219", paidResponse.PaymentRecord.ReferenceNumber);
        Assert.Equal("manual settlement", paidResponse.PaymentRecord.Note);
        var cancelled = await service.CancelAsync(second.Id, "test");
        Assert.Equal("S-271946", cancelled.SettlementNumber);
    }

    [Fact]
    public async Task PublicReference_ExhaustedCandidatesFailExplicitly()
    {
        await using var context = Context();
        context.Settlements.Add(new Settlement { PropertyId = 1, Currency = "IRR", SettlementNumber = "S-583214" });
        await context.SaveChangesAsync();
        var generator = new NumberSequence(context, Enumerable.Repeat(583214, 100).ToArray());
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => generator.GenerateAsync());
        Assert.Contains("100 attempts", error.Message);
    }

    [Fact]
    public async Task PublicReference_DatabaseIndexRejectsDuplicateAndTrackedChangesAreForbidden()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new KoochDbContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Settlements.Add(new Settlement { PropertyId = 1, Currency = "IRR", SettlementNumber = "S-583214" });
        await context.SaveChangesAsync();
        await using (var competing = new KoochDbContext(options))
        {
            competing.Settlements.Add(new Settlement { PropertyId = 1, Currency = "IRR", SettlementNumber = "S-583214" });
            await Assert.ThrowsAsync<DbUpdateException>(() => competing.SaveChangesAsync());
        }
        var original = await context.Settlements.SingleAsync();
        original.SettlementNumber = "S-271946";
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public void PublicReferenceMigration_BackfillsBeforeRequiredUniqueIndex()
    {
        var operations = new AddSettlementPublicReference().UpOperations;
        Assert.Collection(operations,
            item => Assert.True(Assert.IsType<AddColumnOperation>(item).IsNullable),
            item => Assert.Contains("IS NOT NULL", Assert.IsType<CreateIndexOperation>(item).Filter),
            item => {
                var sql = Assert.IsType<SqlOperation>(item).Sql;
                Assert.Contains("CRYPT_GEN_RANDOM", sql);
                Assert.Contains("TABLOCKX, HOLDLOCK", sql);
                Assert.Contains("COUNT_BIG(*)", sql);
                Assert.Contains("THROW 51004", sql);
                Assert.Contains("THROW 51005", sql);
            },
            item => Assert.IsType<DropIndexOperation>(item),
            item => Assert.False(Assert.IsType<AlterColumnOperation>(item).IsNullable),
            item => Assert.Null(Assert.IsType<CreateIndexOperation>(item).Filter));
    }
    private static readonly DateOnly Today = new(2026, 9, 27);
    private sealed class Clock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 9, 27, 0, 0, 0, TimeSpan.Zero);
    }

    private sealed class ReadQueryContext(DbContextOptions<KoochDbContext> options) : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            // SQLite cannot generate the SQL Server rowversion used by Reservation.
            modelBuilder.Entity<Reservation>().Property(item => item.RowVersion).ValueGeneratedNever();
        }
    }

    private static KoochDbContext Context()
    {
        var context = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        context.Properties.AddRange(new Property { Id = 1, Name = "First", Slug = "first" },
            new Property { Id = 2, Name = "Second", Slug = "second" });
        context.Reservations.AddRange(Enumerable.Range(1, 6).Select(id => ReservationFor(id)));
        context.SaveChanges();
        return context;
    }

    private static Reservation ReservationFor(int id, int property = 1) => new()
    {
        Id = id, PropertyId = property, ReservationNumber = $"R-{100000 + id}"
    };

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
        var paid = await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        Assert.Equal(PaymentRequest().PaidAtUtc!.Value.UtcDateTime, paid.PaidAtUtc);
        Assert.Equal(paid.PaidAtUtc, paid.PaymentRecord!.PaidAtUtc);
        Assert.Equal("0087453219", paid.PaymentRecord.ReferenceNumber);
        Assert.Equal("manual settlement", paid.PaymentRecord.Note);
        Assert.Equal(77, paid.PaymentRecord.RecordedByUserId);
        Assert.Equal(new Clock().GetUtcNow().UtcDateTime, paid.PaymentRecord.RecordedAtUtc);
        Assert.Equal(SettlementStatus.Paid, paid.GetStatus(Today));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.MarkPaidAsync(paid.Id, PaymentRequest(), 77));
        Assert.Single(await context.SettlementPaymentRecords.ToListAsync());
        Assert.Equal(2, await context.FinancialEntries.CountAsync());
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(1, [2]));
        paid.PaymentRecord.Note = "changed";
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync());
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
        await service.MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
        Assert.Equal(Today.AddDays(3), settlement.Items.Single().FinancialEntry.PayableDueDate);
        Assert.True(DateOnly.FromDateTime(settlement.PaidAtUtc!.Value) < Today.AddDays(3));
    }

    [Fact]
    public async Task UniqueIndex_RejectsDuplicateAcrossContexts_AndLinksAreImmutable()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new ReadQueryContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Reservations.Add(ReservationFor(1));
        context.FinancialEntries.Add(Payable(1));
        await context.SaveChangesAsync();
        var settlement = await new SettlementService(context, new Clock()).CreateAsync(1, [1]);
        var listed = await new SettlementService(context, new Clock()).ListAsync(new SettlementListQuery());
        Assert.Equal(SettlementStatus.Due, Assert.Single(listed.Items).Status);
        Assert.Empty((await new SettlementService(context, new Clock()).ListPayablesAsync(new SettlementListQuery())).Items);
        await using (var competing = new KoochDbContext(options))
        {
            competing.Settlements.Add(new Settlement { PropertyId = 1, Currency = "IRR", TotalAmount = 123.45m,
                Items = [new SettlementItem { FinancialEntryId = 1, ReservationNumberSnapshot = "R-100001" }] });
            await Assert.ThrowsAsync<DbUpdateException>(() => competing.SaveChangesAsync());
        }
        Assert.Single(await context.Settlements.ToListAsync());
        await using (var competing = new KoochDbContext(options))
        {
            var service = new SettlementService(competing, new Clock());
            await service.GetAsync(settlement.Id);
            var paid = await new SettlementService(context, new Clock()).MarkPaidAsync(settlement.Id, PaymentRequest(), 77);
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.MarkPaidAsync(settlement.Id, PaymentRequest(), 88));
            Assert.Equal(paid.PaidAtUtc, paid.PaymentRecord!.PaidAtUtc);
        }
        Assert.Single(await context.SettlementPaymentRecords.ToListAsync());
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
        await service.MarkPaidAsync(batch.Id, PaymentRequest(), 77);
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
    [InlineData("Overdue", 1)]
    [InlineData("Due", 2)]
    [InlineData("Future", 3)]
    public async Task PayableStatus_FiltersBeforePaginationAndKeepsPropertyScope(string status, int expectedId)
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1, days: -1), Payable(2), Payable(3, days: 1),
            Payable(4, property: 2));
        await context.SaveChangesAsync();
        var page = await new SettlementService(context, new Clock()).ListPayablesAsync(
            new SettlementListQuery { PropertyId = 1, Status = status, PageSize = 1 });
        Assert.Equal(1, page.TotalCount);
        Assert.Equal(1, page.TotalPages);
        Assert.Equal(expectedId, Assert.Single(page.Items).Id);
    }

    [Fact]
    public async Task PayableSearch_UsesTrimmedPublicReservationReferenceAndPropertyScope()
    {
        await using var context = Context();
        (await context.Reservations.SingleAsync(item => item.Id == 1)).ReservationNumber = "R-583214";
        (await context.Reservations.SingleAsync(item => item.Id == 2)).ReservationNumber = "R-271946";
        (await context.Reservations.SingleAsync(item => item.Id == 3)).ReservationNumber = "R-583215";
        context.FinancialEntries.AddRange(Payable(1), Payable(2), Payable(3, property: 2));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var page = await service.ListPayablesAsync(new SettlementListQuery { PropertyId = 1, Search = " R-58321 " });
        Assert.Equal(1, page.TotalCount);
        Assert.Equal("R-583214", Assert.Single(page.Items).ReservationNumber);
        Assert.Empty((await service.ListPayablesAsync(new SettlementListQuery { Search = "R-999999" })).Items);
    }

    [Theory]
    [InlineData("PayableDueDate", "Asc", 1, 3, 2)]
    [InlineData("PayableDueDate", "Desc", 2, 3, 1)]
    [InlineData("Amount", "Asc", 2, 3, 1)]
    [InlineData("Amount", "Desc", 1, 3, 2)]
    public async Task PayableSort_IsDeterministicAndAppliedBeforePaging(string field, string direction, int first, int second, int third)
    {
        await using var context = Context();
        var entries = new[] { Payable(1, days: -1), Payable(2, days: 1), Payable(3) };
        entries[0].Amount = 300m;
        entries[1].Amount = entries[2].Amount = 100m;
        context.FinancialEntries.AddRange(entries);
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var query = new SettlementListQuery { SortBy = field, SortDirection = direction };
        Assert.Equal(new[] { first, second, third }, (await service.ListPayablesAsync(query)).Items.Select(item => item.Id));
        query.Page = 2; query.PageSize = 1;
        var page = await service.ListPayablesAsync(query);
        Assert.Equal(second, Assert.Single(page.Items).Id);
        Assert.Equal(3, page.TotalCount);
        Assert.Equal(3, page.TotalPages);
    }

    [Theory]
    [InlineData("Pending", 1)]
    [InlineData("Due", 2)]
    [InlineData("Overdue", 3)]
    [InlineData("Paid", 4)]
    [InlineData("Cancelled", 5)]
    public async Task SettlementStatus_UsesExistingLifecycleAndFiltersBeforePaging(string status, int expectedId)
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Payable(1, days: 1), Payable(2), Payable(3, days: -1), Payable(4), Payable(5), Payable(6, property: 2));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        foreach (var id in Enumerable.Range(1, 5)) await service.CreateAsync(1, [id], allowEarlySettlement: id == 1);
        await service.MarkPaidAsync(4, PaymentRequest(), 77);
        await service.CancelAsync(5, "Correction");
        await service.CreateAsync(2, [6]);
        var page = await service.ListAsync(new SettlementListQuery { Status = status, PropertyId = 1, PageSize = 1 });
        Assert.Equal(1, page.TotalCount);
        Assert.Equal(1, page.TotalPages);
        Assert.Equal(expectedId, Assert.Single(page.Items).Id);
    }

    [Theory]
    [InlineData("CreatedAt", "Asc", 1, 2, 3)]
    [InlineData("CreatedAt", "Desc", 3, 2, 1)]
    [InlineData("TotalAmount", "Asc", 2, 3, 1)]
    [InlineData("TotalAmount", "Desc", 1, 3, 2)]
    [InlineData("ItemCount", "Asc", 2, 3, 1)]
    [InlineData("ItemCount", "Desc", 1, 3, 2)]
    public async Task SettlementSort_IsDeterministicAndAppliedBeforePaging(string field, string direction, int first, int second, int third)
    {
        await using var context = Context();
        context.FinancialEntries.AddRange(Enumerable.Range(1, 4).Select(id => Payable(id)));
        context.Settlements.AddRange(new Settlement { Id = 1, PropertyId = 1, Currency = "IRR", TotalAmount = 246.9m,
                Items = [new SettlementItem { FinancialEntryId = 1, ReservationNumberSnapshot = "R-100001" },
                    new SettlementItem { FinancialEntryId = 2, ReservationNumberSnapshot = "R-100002" }] },
            new Settlement { Id = 2, PropertyId = 1, Currency = "IRR", TotalAmount = 123.45m,
                Items = [new SettlementItem { FinancialEntryId = 3, ReservationNumberSnapshot = "R-100003" }] },
            new Settlement { Id = 3, PropertyId = 1, Currency = "IRR", TotalAmount = 123.45m,
                Items = [new SettlementItem { FinancialEntryId = 4, ReservationNumberSnapshot = "R-100004" }] });
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var query = new SettlementListQuery { SortBy = field, SortDirection = direction };
        Assert.Equal(new[] { first, second, third }, (await service.ListAsync(query)).Items.Select(item => item.Id));
        query.Page = 2; query.PageSize = 1;
        var page = await service.ListAsync(query);
        Assert.Equal(second, Assert.Single(page.Items).Id);
        Assert.Equal(3, page.TotalCount);
        Assert.Equal(3, page.TotalPages);
    }

    [Theory]
    [InlineData(true, "TotalAmount", "Asc", null)]
    [InlineData(true, "Amount", "DROP TABLE", null)]
    [InlineData(true, null, null, "Paid")]
    [InlineData(false, "Amount", "Desc", null)]
    [InlineData(false, "CreatedAt", "random", null)]
    [InlineData(false, null, null, "Future")]
    public async Task ListQueries_RejectUnsupportedFieldsDirectionsAndStatuses(bool payables, string? sortBy, string? direction, string? status)
    {
        await using var context = Context();
        var service = new SettlementService(context, new Clock());
        var query = new SettlementListQuery { SortBy = sortBy, SortDirection = direction, Status = status };
        if (payables) await Assert.ThrowsAsync<ArgumentException>(() => service.ListPayablesAsync(query));
        else await Assert.ThrowsAsync<ArgumentException>(() => service.ListAsync(query));
    }

    [Fact]
    public async Task RelationalLists_TranslateStatusSearchAndSortWithoutLoadingAllRows()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        await using var context = new ReadQueryContext(new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        var firstReservation = ReservationFor(1);
        firstReservation.ReservationNumber = "R-583214";
        context.Reservations.AddRange(firstReservation, ReservationFor(2), ReservationFor(3));
        context.FinancialEntries.AddRange(Payable(1), Payable(2, days: -1), Payable(3, days: 1));
        await context.SaveChangesAsync();
        var service = new SettlementService(context, new Clock());
        var payable = await service.ListPayablesAsync(new SettlementListQuery { Status = "Due", Search = " R-583214 ", SortDirection = "Desc", PageSize = 1 });
        Assert.Equal(1, payable.TotalCount);
        Assert.Equal(1, Assert.Single(payable.Items).Id);
        var batch = await service.CreateAsync(1, [1, 2]);
        await service.CreateAsync(1, [3], allowEarlySettlement: true);
        var overdue = await service.ListAsync(new SettlementListQuery { Status = "Overdue", SortBy = "ItemCount", SortDirection = "Asc", PageSize = 1 });
        Assert.Equal(batch.Id, Assert.Single(overdue.Items).Id);
        Assert.Equal(1, overdue.TotalCount);
        await service.CancelAsync(batch.Id, "Correction");
        var cancelled = await service.ListAsync(new SettlementListQuery { Status = "Cancelled", SortBy = "CreatedAt", SortDirection = "Asc" });
        Assert.Equal(batch.Id, Assert.Single(cancelled.Items).Id);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(3)]
    public async Task Cancellation_PreservesHistoryReleasesAllItemsAndAllowsNewBatch(int dueDays)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options;
        await using var context = new ReadQueryContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        context.Reservations.AddRange(ReservationFor(1), ReservationFor(2));
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
        Assert.Equal("R-100001", cancelled.Items.Single(item => item.FinancialEntryId == 1).ReservationNumberSnapshot);
        Assert.Equal(2, (await service.ListPayablesAsync(new SettlementListQuery())).TotalCount);
        Assert.Equal(SettlementStatus.Cancelled, Assert.Single((await service.ListAsync(new SettlementListQuery())).Items).Status);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CancelAsync(batch.Id, "Again"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.MarkPaidAsync(batch.Id, PaymentRequest(), 77));

        (await context.Reservations.SingleAsync(item => item.Id == 1)).ReservationNumber = "R-654321";
        await context.SaveChangesAsync();
        var replacement = await service.CreateAsync(1, [1, 2], allowEarlySettlement: dueDays > 0);
        Assert.Equal("R-100001", cancelled.Items.Single(item => item.FinancialEntryId == 1).ReservationNumberSnapshot);
        Assert.Equal("R-654321", replacement.Items.Single(item => item.FinancialEntryId == 1).ReservationNumberSnapshot);
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
            Items = [new SettlementItem { FinancialEntryId = 1, ReservationNumberSnapshot = "R-100001" }] });
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
        await service.MarkPaidAsync(batch.Id, PaymentRequest(), 77);
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
        await using var first = new ReadQueryContext(options);
        await first.Database.EnsureCreatedAsync();
        first.Properties.Add(new Property { Id = 1, Name = "First", Slug = "first" });
        first.Reservations.AddRange(ReservationFor(1), ReservationFor(2));
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
            await Assert.ThrowsAsync<InvalidOperationException>(() => secondService.MarkPaidAsync(batch.Id, PaymentRequest(), 77));
        }
        else
        {
            await firstService.MarkPaidAsync(batch.Id, PaymentRequest(), 77);
            await Assert.ThrowsAsync<InvalidOperationException>(() => secondService.CancelAsync(batch.Id, "Correction", 7));
        }
        await using var verify = new KoochDbContext(options);
        var saved = await new SettlementService(verify, new Clock()).GetAsync(batch.Id);
        Assert.Equal(cancellationWins, saved.CancelledAtUtc.HasValue);
        Assert.Equal(!cancellationWins, saved.PaidAtUtc.HasValue);
        Assert.All(saved.Items, item => Assert.Equal(cancellationWins, item.ReleasedAtUtc.HasValue));
        Assert.Equal(cancellationWins ? "Correction" : null, saved.CancellationReason);
        Assert.Equal(cancellationWins ? 0 : 1, await verify.SettlementPaymentRecords.CountAsync());
        if (!cancellationWins)
            Assert.Equal("First", saved.PaymentRecord!.PropertyNameSnapshot);
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
