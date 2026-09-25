using System.Globalization;
using System.Reflection;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class ReservationVoucherIssuanceTests
{
    [Fact]
    public async Task Number_IsOpaqueSixDigitReferenceIndependentFromReservationNumber()
    {
        await using var context = CreateContext();
        var number = await new CandidateGenerator(context, 583214).GenerateAsync();

        Assert.Equal("V-583214", number);
        Assert.Matches("^V-[0-9]{6}$", number);
        Assert.InRange(int.Parse(number[2..], CultureInfo.InvariantCulture), 100000, 999999);
        Assert.DoesNotContain("R-271946", number);
    }

    [Fact]
    public async Task Number_RetriesPersistedSoftDeletedAndTrackedCollisions()
    {
        var options = CreateOptions();
        await using (var setup = new KoochDbContext(options))
        {
            setup.ReservationVouchers.AddRange(
                Voucher(1, "V-100000"),
                Voucher(2, "V-200000", isDeleted: true));
            await setup.SaveChangesAsync();
        }

        await using var context = new KoochDbContext(options);
        context.ReservationVouchers.Add(Voucher(3, "V-300000"));
        var generator = new CandidateGenerator(context, 100000, 200000, 300000, 400000);

        Assert.Equal("V-400000", await generator.GenerateAsync());
        Assert.Equal(4, generator.Calls);
    }

    [Fact]
    public async Task Number_FailsExplicitlyAfterBoundedCandidateCollisions()
    {
        await using var context = CreateContext();
        context.ReservationVouchers.Add(Voucher(1, "V-123456"));
        var generator = new CandidateGenerator(context, 123456);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => generator.GenerateAsync());

        Assert.Contains("100 attempts", error.Message);
        Assert.Equal(100, generator.Calls);
    }

    [Theory]
    [InlineData(2601)]
    [InlineData(2627)]
    public async Task Save_RetriesOnlyVoucherNumberUniqueCollision(int sqlNumber)
    {
        await using var context = await CreateFailingSaveContextAsync(
            sqlNumber,
            "IX_ReservationVouchers_VoucherNumber",
            failures: 1);
        await using var transaction = await context.Database.BeginTransactionAsync();
        var voucher = Voucher(1, "V-111111");
        context.ReservationVouchers.Add(voucher);

        await context.SaveWithVoucherNumberRetryAsync();

        Assert.Equal(2, context.Attempts);
        Assert.Matches("^V-[0-9]{6}$", voucher.VoucherNumber);
        Assert.NotEqual("V-111111", voucher.VoucherNumber);
        Assert.Equal(1, await context.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS Value FROM AttemptWrites").SingleAsync());
    }

    [Fact]
    public async Task Save_FailsExplicitlyAfterFiveVoucherNumberCollisions()
    {
        await using var context = await CreateFailingSaveContextAsync(
            2601,
            "IX_ReservationVouchers_VoucherNumber",
            failures: 10);
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.ReservationVouchers.Add(Voucher(1, "V-111111"));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            context.SaveWithVoucherNumberRetryAsync());

        Assert.Contains("5 attempts", error.Message);
        Assert.IsType<DbUpdateException>(error.InnerException);
        Assert.Equal(5, context.Attempts);
        Assert.Equal(0, await context.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS Value FROM AttemptWrites").SingleAsync());
    }

    [Theory]
    [InlineData(2601, "IX_ReservationVouchers_ReservationId")]
    [InlineData(547, "IX_ReservationVouchers_VoucherNumber")]
    [InlineData(1205, "IX_ReservationVouchers_VoucherNumber")]
    [InlineData(2601, "IX_ReservationVouchers_VoucherNumber_Other")]
    public async Task Save_DoesNotRetryUnrelatedDatabaseErrors(int sqlNumber, string index)
    {
        await using var context = await CreateFailingSaveContextAsync(sqlNumber, index, failures: 1);
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.ReservationVouchers.Add(Voucher(1, "V-111111"));

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveWithVoucherNumberRetryAsync());

        Assert.Equal(1, context.Attempts);
    }

    [Fact]
    public async Task Issue_CopiesAuthoritativeSourcesAndFinancialSnapshotExactly()
    {
        await using var harness = await VoucherHarness.CreateAsync();
        var before = DateTime.UtcNow;

        var voucher = await harness.Service.IssueAsync(harness.Reservation, harness.Payment, null);
        await harness.Context.SaveChangesAsync();

        Assert.Equal("V-583214", voucher.VoucherNumber);
        Assert.InRange(voucher.IssuedAtUtc, before, DateTime.UtcNow);
        Assert.Equal(harness.Reservation.Id, voucher.ReservationId);
        Assert.Equal(harness.Snapshot.Id, voucher.ReservationFinancialSnapshotId);
        Assert.Equal("R-271946", voucher.ReservationNumberSnapshot);
        Assert.Equal("Snapshot property", voucher.PropertyNameSnapshot);
        Assert.Equal("Canonical Guest", voucher.GuestNameSnapshot);
        Assert.Equal("09120000000", voucher.GuestMobileSnapshot);
        Assert.Equal("guest@kooch.local", voucher.GuestEmailSnapshot);
        Assert.Equal("Snapshot room type", voucher.RoomTypeNameSnapshot);
        Assert.Null(voucher.RoomNameSnapshot);
        Assert.Equal(new DateOnly(2036, 1, 1), voucher.CheckInSnapshot);
        Assert.Equal(new DateOnly(2036, 1, 4), voucher.CheckOutSnapshot);
        Assert.Equal(3, voucher.NightsSnapshot);
        Assert.Equal(2, voucher.AdultCountSnapshot);
        Assert.Equal(1, voucher.ChildCountSnapshot);
        Assert.Equal(harness.Snapshot.GrossAmount, voucher.GrossAmount);
        Assert.Equal(harness.Snapshot.Currency, voucher.Currency);
        Assert.Equal(harness.Snapshot.CommissionRate, voucher.CommissionRate);
        Assert.Equal(harness.Snapshot.CommissionAmount, voucher.CommissionAmount);
        Assert.Equal(harness.Snapshot.PropertyPayableAmount, voucher.PropertyPayableAmount);
        Assert.Empty(harness.Context.SiteSettings);
    }

    [Fact]
    public async Task Issue_IsIdempotentAndDoesNotModifyExistingVoucher()
    {
        await using var harness = await VoucherHarness.CreateAsync();
        var first = await harness.Service.IssueAsync(harness.Reservation, harness.Payment, null);
        await harness.Context.SaveChangesAsync();
        var number = first.VoucherNumber;
        var issuedAt = first.IssuedAtUtc;

        var second = await harness.Service.IssueAsync(harness.Reservation, harness.Payment, null);
        await harness.Context.SaveChangesAsync();

        Assert.Same(first, second);
        Assert.Equal(number, second.VoucherNumber);
        Assert.Equal(issuedAt, second.IssuedAtUtc);
        Assert.Equal(1, await harness.Context.ReservationVouchers.CountAsync());
    }

    [Fact]
    public async Task Issue_PersistsImmutableDisplaySnapshotAfterSourcesChange()
    {
        await using var harness = await VoucherHarness.CreateAsync();
        var voucher = await harness.Service.IssueAsync(harness.Reservation, harness.Payment, null);
        await harness.Context.SaveChangesAsync();

        harness.Property.Name = "Changed property";
        harness.Client.FirstName = "Changed";
        harness.RoomType.Name = "Changed room type";
        await harness.Context.SaveChangesAsync();
        harness.Context.ChangeTracker.Clear();
        var persisted = await harness.Context.ReservationVouchers.SingleAsync();

        Assert.Equal("Snapshot property", persisted.PropertyNameSnapshot);
        Assert.Equal("Canonical Guest", persisted.GuestNameSnapshot);
        Assert.Equal("Snapshot room type", persisted.RoomTypeNameSnapshot);
        Assert.Equal(voucher.GrossAmount, persisted.GrossAmount);
    }

    [Fact]
    public async Task Issue_RequiresConfirmedReservationAndAuthoritativeFinancialSnapshot()
    {
        await using var harness = await VoucherHarness.CreateAsync();
        harness.Reservation.Status = ReservationStatus.ApprovedAwaitingPayment;
        var statusError = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.IssueAsync(harness.Reservation, harness.Payment, null));
        Assert.Contains("confirmed", statusError.Message, StringComparison.OrdinalIgnoreCase);

        harness.Reservation.Status = ReservationStatus.Confirmed;
        var unrelatedPayment = new Payment
        {
            Id = 99,
            ReservationId = harness.Reservation.Id,
            Amount = harness.Payment.Amount,
            Currency = harness.Payment.Currency,
            Status = PaymentStatus.Successful
        };
        var snapshotError = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.IssueAsync(harness.Reservation, unrelatedPayment, null));
        Assert.Contains("financial snapshot", snapshotError.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.ReservationVouchers.ToListAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Issue_RejectsMissingReservationNumber(string? reservationNumber)
    {
        await using var harness = await VoucherHarness.CreateAsync();
        harness.Reservation.ReservationNumber = reservationNumber;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.IssueAsync(harness.Reservation, harness.Payment, null));

        Assert.Contains("reservation number", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.ReservationVouchers.ToListAsync());
    }

    [Fact]
    public async Task Issue_RejectsInvalidStayRange()
    {
        await using var harness = await VoucherHarness.CreateAsync();
        harness.Reservation.CheckOutDate = harness.Reservation.CheckInDate;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            harness.Service.IssueAsync(harness.Reservation, harness.Payment, null));

        Assert.Contains("stay range", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await harness.Context.ReservationVouchers.ToListAsync());
    }

    private static DbContextOptions<KoochDbContext> CreateOptions() =>
        new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase($"voucher-issuance-{Guid.NewGuid():N}")
            .Options;

    private static KoochDbContext CreateContext() => new(CreateOptions());

    private static ReservationVoucher Voucher(int reservationId, string number, bool isDeleted = false) =>
        new()
        {
            ReservationId = reservationId,
            VoucherNumber = number,
            IsDeleted = isDeleted
        };

    private sealed class CandidateGenerator(KoochDbContext context, params int[] candidates)
        : VoucherNumberGenerator(context)
    {
        public int Calls { get; private set; }
        protected override int NextNumber() => candidates[Math.Min(Calls++, candidates.Length - 1)];
    }

    private static async Task<FailingSaveContext> CreateFailingSaveContextAsync(
        int sqlNumber,
        string index,
        int failures)
    {
        var context = new FailingSaveContext(
            new DbContextOptionsBuilder<KoochDbContext>()
                .UseSqlite("Data Source=:memory:")
                .Options,
            sqlNumber,
            index,
            failures);
        await context.Database.OpenConnectionAsync();
        await context.Database.EnsureCreatedAsync();
        await context.Database.ExecuteSqlRawAsync("CREATE TABLE AttemptWrites (Id INTEGER)");
        return context;
    }

    private sealed class FailingSaveContext(
        DbContextOptions<KoochDbContext> options,
        int sqlNumber,
        string index,
        int failures) : KoochDbContext(options)
    {
        public int Attempts { get; private set; }

        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            Attempts++;
            await Database.ExecuteSqlRawAsync("INSERT INTO AttemptWrites VALUES (1)", cancellationToken);
            if (Attempts <= failures)
            {
                throw new DbUpdateException("Save failed", CreateSqlException(sqlNumber, index));
            }

            return 1;
        }
    }

    private static SqlException CreateSqlException(int number, string index)
    {
        var errorConstructor = typeof(SqlError).GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic)
            .Single(constructor => constructor.GetParameters().Length == 9);
        var error = (SqlError)errorConstructor.Invoke(
            new object?[]
            {
                number,
                (byte)1,
                (byte)14,
                "server",
                $"Violation of unique index '{index}'.",
                "",
                1,
                (uint)0,
                null
            });
        var collection = (SqlErrorCollection)Activator.CreateInstance(
            typeof(SqlErrorCollection),
            nonPublic: true)!;
        typeof(SqlErrorCollection).GetMethod("Add", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(collection, [error]);
        return (SqlException)typeof(SqlException).GetMethod(
            "CreateException",
            BindingFlags.Static | BindingFlags.NonPublic,
            null,
            [typeof(SqlErrorCollection), typeof(string)],
            null)!.Invoke(null, [collection, "16.0"])!;
    }

    private sealed class VoucherHarness : IAsyncDisposable
    {
        private VoucherHarness(
            KoochDbContext context,
            User client,
            Property property,
            RoomType roomType,
            Reservation reservation,
            Payment payment,
            ReservationFinancialSnapshot snapshot)
        {
            Context = context;
            Client = client;
            Property = property;
            RoomType = roomType;
            Reservation = reservation;
            Payment = payment;
            Snapshot = snapshot;
            Service = new ReservationVoucherService(
                context,
                new CandidateGenerator(context, 583214));
        }

        public KoochDbContext Context { get; }
        public User Client { get; }
        public Property Property { get; }
        public RoomType RoomType { get; }
        public Reservation Reservation { get; }
        public Payment Payment { get; }
        public ReservationFinancialSnapshot Snapshot { get; }
        public ReservationVoucherService Service { get; }

        public static async Task<VoucherHarness> CreateAsync()
        {
            var context = CreateContext();
            var client = new User
            {
                Id = 1,
                FirstName = "Canonical",
                LastName = "Guest",
                PhoneNumber = "09120000000",
                Email = "guest@kooch.local",
                PasswordHash = "not-used",
                Role = UserRole.Client,
                IsActive = true
            };
            var property = new Property
            {
                Id = 10,
                OwnerId = 1,
                Name = "Snapshot property",
                Slug = "snapshot-property"
            };
            var roomType = new RoomType
            {
                Id = 20,
                PropertyId = property.Id,
                Name = "Snapshot room type",
                Slug = "snapshot-room-type",
                TotalInventory = 1,
                InventoryMode = InventoryMode.TypeBasedInventory
            };
            var reservation = new Reservation
            {
                Id = 30,
                ReservationNumber = "R-271946",
                ClientId = client.Id,
                PropertyId = property.Id,
                RoomTypeId = roomType.Id,
                CheckInDate = new DateOnly(2036, 1, 1),
                CheckOutDate = new DateOnly(2036, 1, 4),
                AdultCount = 2,
                ChildCount = 1,
                TotalPrice = 123.45m,
                FinalAmount = 123.45m,
                Currency = "IRR",
                CommissionType = CommissionType.Direct,
                Status = ReservationStatus.Confirmed,
                Source = ReservationSource.Website
            };
            var payment = new Payment
            {
                Id = 40,
                ReservationId = reservation.Id,
                Amount = 123.45m,
                Currency = "IRR",
                Status = PaymentStatus.Successful
            };
            var snapshot = new ReservationFinancialSnapshot
            {
                Id = 50,
                ReservationId = reservation.Id,
                PropertyId = property.Id,
                PaymentId = payment.Id,
                GrossAmount = 123.45m,
                Currency = "IRR",
                CommissionType = CommissionType.Direct,
                CommissionRateSource = CommissionRateSource.Global,
                CommissionRate = 12.5m,
                CommissionBase = 123.45m,
                CommissionAmount = 15.43m,
                PropertyPayableAmount = 108.02m,
                CalculatedAtUtc = DateTime.UtcNow
            };
            context.AddRange(client, property, roomType, reservation, payment, snapshot);
            await context.SaveChangesAsync();
            return new VoucherHarness(context, client, property, roomType, reservation, payment, snapshot);
        }

        public ValueTask DisposeAsync() => Context.DisposeAsync();
    }
}
