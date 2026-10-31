using System.Data.Common;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class WelcomeGiftSqlServerConcurrencyTests : IAsyncLifetime
{
    private readonly WelcomeGiftSqlServerDatabase database = new();

    public Task InitializeAsync() => database.InitializeAsync();
    public Task DisposeAsync() => database.DisposeAsync();

    [SqlServerWalletFact]
    public async Task ConcurrentEligibleIdentities_DoNotExceedCampaignQuota()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task Attempt(int userId)
        {
            await gate.Task;
            await using var db = database.NewContext();
            await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            var user = await db.Users.SingleAsync(row => row.Id == userId);
            await new WelcomeGiftGrantService(db, TimeProvider.System)
                .TryGrantForVerifiedRegistrationAsync(user);
            await transaction.CommitAsync();
        }

        var first = Attempt(database.FirstUserId);
        var second = Attempt(database.SecondUserId);
        gate.SetResult();
        await Task.WhenAll(first, second);

        await using var verify = database.NewContext();
        Assert.Equal(1, (await verify.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
        Assert.Single(await verify.WelcomeGiftGrants.ToListAsync());
        Assert.Single(await verify.WalletLots.ToListAsync());
        Assert.Single(await verify.WalletEntries.ToListAsync());
        Assert.Equal(2, await verify.Users.CountAsync());
    }

    [SqlServerWalletFact]
    public Task ConcurrentVerificationOfSameOtp_GrantsOnlyOnce() =>
        AssertConcurrentOtpVerificationAsync(reissue: false);

    [SqlServerWalletFact]
    public Task ConcurrentVerificationOfReissuedOtps_GrantsOnlyOnce() =>
        AssertConcurrentOtpVerificationAsync(reissue: true);

    [SqlServerWalletFact]
    public async Task ConcurrentNewRegistrations_CompleteAutomaticallyAndQuotaStaysConsistent()
    {
        const string firstMobile = "09121234567";
        const string secondMobile = "09121234568";
        string firstCode;
        string secondCode;
        await using (var setup = database.NewContext())
        {
            var auth = CreateAuthService(setup);
            firstCode = (await auth.RequestOtpAsync(new RequestOtpRequest
            {
                Mobile = firstMobile, AllowRegistration = true,
                FirstName = "First", LastName = "New", NationalCode = "1234567891"
            })).DevOtpCode!;
            secondCode = (await auth.RequestOtpAsync(new RequestOtpRequest
            {
                Mobile = secondMobile, AllowRegistration = true,
                FirstName = "Second", LastName = "New", NationalCode = "0012345679"
            })).DevOtpCode!;
        }

        var barrier = new OtpVerificationBarrier();
        async Task<AuthResponse?> VerifyAsync(string mobile, string code)
        {
            await using var request = database.NewContext(barrier);
            return await CreateAuthService(request).VerifyOtpAsync(new VerifyOtpRequest
            {
                Mobile = mobile, Code = code
            });
        }
        var outcomes = await Task.WhenAll(
            VerifyAsync(firstMobile, firstCode), VerifyAsync(secondMobile, secondCode));
        Assert.InRange(barrier.Arrivals, 2, 6);
        Assert.All(outcomes, response => Assert.NotNull(response));

        await using var persisted = database.NewContext();
        var users = await persisted.Users
            .Where(user => user.PhoneNumber == firstMobile || user.PhoneNumber == secondMobile).ToListAsync();
        Assert.Equal(2, users.Count);
        Assert.All(users, user =>
        {
            Assert.True(user.IsActive);
            Assert.Null(user.PendingRegistrationNationalCode);
        });
        Assert.Equal(2, await persisted.Guests.CountAsync());
        var otps = await persisted.MobileOtpCodes.ToListAsync();
        Assert.Equal(2, otps.Count);
        Assert.All(otps, otp => Assert.NotNull(otp.UsedAtUtc));
        var grant = Assert.Single(await persisted.WelcomeGiftGrants.ToListAsync());
        var account = Assert.Single(await persisted.WalletAccounts.ToListAsync());
        Assert.Contains(grant.UserId, users.Select(user => user.Id));
        Assert.Equal(grant.UserId, account.UserId);
        Assert.Single(await persisted.WalletLots.ToListAsync());
        var credit = Assert.Single(await persisted.WalletEntries.ToListAsync());
        Assert.Equal(100m, credit.Amount);
        Assert.Equal(credit.Id, grant.WalletEntryId);
        var campaign = await persisted.WelcomeGiftCampaigns.SingleAsync();
        Assert.Equal(campaign.MaxRecipients, campaign.GrantedCount);
        Assert.Equal(await persisted.WelcomeGiftGrants.CountAsync(), campaign.GrantedCount);
    }

    private async Task AssertConcurrentOtpVerificationAsync(bool reissue)
    {
        const string mobile = "09121234567";
        string originalCode;
        string secondCode;
        int guestId;
        await using (var setup = database.NewContext())
        {
            var guest = new Guest { FirstName = "Existing", LastName = "Guest", NormalizedMobile = mobile };
            setup.Guests.Add(guest);
            await setup.SaveChangesAsync();
            guestId = guest.Id;
            var auth = CreateAuthService(setup);
            var requested = await auth.RequestOtpAsync(new RequestOtpRequest
            {
                Mobile = mobile, AllowRegistration = true,
                FirstName = "New", LastName = "User", NationalCode = "1234567891"
            });
            originalCode = requested.DevOtpCode!;
            secondCode = originalCode;
            if (reissue)
            {
                await setup.MobileOtpCodes.ExecuteUpdateAsync(setters => setters
                    .SetProperty(row => row.CreatedAtUtc, DateTime.UtcNow.AddMinutes(-2)));
                var reissued = await auth.RequestOtpAsync(new RequestOtpRequest
                {
                    Mobile = mobile, AllowRegistration = true, NationalCode = "0012345679"
                });
                secondCode = reissued.DevOtpCode!;
            }
        }

        var barrier = new OtpVerificationBarrier();
        async Task<AuthResponse?> VerifyAsync(string code)
        {
            await using var request = database.NewContext(barrier);
            return await CreateAuthService(request).VerifyOtpAsync(new VerifyOtpRequest
            {
                Mobile = mobile, Code = code
            });
        }
        var outcomes = await Task.WhenAll(VerifyAsync(originalCode), VerifyAsync(secondCode));
        Assert.InRange(barrier.Arrivals, 2, 6);
        var success = Assert.Single(outcomes, response => response is not null)!;

        await using var persisted = database.NewContext();
        var user = await persisted.Users.SingleAsync(row => row.PhoneNumber == mobile);
        Assert.True(user.IsActive);
        Assert.Null(user.PendingRegistrationNationalCode);
        Assert.Equal(user.Id, success.UserId);
        Assert.Equal(guestId, success.GuestId);
        Assert.Equal(user.Id, (await persisted.Guests.SingleAsync()).UserId);
        var otps = await persisted.MobileOtpCodes.ToListAsync();
        Assert.Equal(reissue ? 2 : 1, otps.Count);
        Assert.All(otps, otp => Assert.NotNull(otp.UsedAtUtc));
        var grant = Assert.Single(await persisted.WelcomeGiftGrants.ToListAsync());
        var account = Assert.Single(await persisted.WalletAccounts.ToListAsync());
        var lot = Assert.Single(await persisted.WalletLots.ToListAsync());
        var credit = Assert.Single(await persisted.WalletEntries.ToListAsync());
        Assert.Equal(user.Id, grant.UserId);
        Assert.Equal("1234567891", grant.NationalCodeSnapshot);
        Assert.Equal(user.Id, account.UserId);
        Assert.Equal(account.Id, lot.WalletAccountId);
        Assert.Equal(lot.Id, grant.WalletLotId);
        Assert.Equal(lot.Id, credit.WalletLotId);
        Assert.Equal(credit.Id, grant.WalletEntryId);
        Assert.Equal(WalletEntryDirection.Credit, credit.Direction);
        Assert.Equal(100m, credit.Amount);
        Assert.Equal(credit.Amount, grant.AmountSnapshot);
        Assert.False(lot.IsWithdrawable);
        Assert.Equal(grant.ExpiresAtUtc, lot.ExpiresAtUtc);
        Assert.Equal(1, (await persisted.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);

        await using var replay = database.NewContext();
        Assert.Null(await CreateAuthService(replay).VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = mobile, Code = originalCode
        }));
        Assert.Null(await CreateAuthService(replay).VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = mobile, Code = secondCode
        }));
        Assert.Equal(1, await replay.WelcomeGiftGrants.CountAsync());
        Assert.Equal(1, await replay.WalletLots.CountAsync());
        Assert.Equal(1, await replay.WalletEntries.CountAsync());
        Assert.Equal(1, (await replay.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    internal static AuthService CreateAuthService(KoochDbContext context) => new(
        context,
        Options.Create(new JwtOptions
        {
            Key = "0123456789abcdef0123456789abcdef", Issuer = "tests", Audience = "tests"
        }),
        new PropertyAccessService(context), new TestHostEnvironment(), new NoNotifications());

    private sealed class NoNotifications : INotificationService
    {
        public Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class OtpVerificationBarrier : DbCommandInterceptor
    {
        private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int arrivals;
        public int Arrivals => Volatile.Read(ref arrivals);

        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            // Both requests read a usable OTP before either takes the authoritative User lock.
            if (command.CommandText.Contains("FROM Users WITH (UPDLOCK, HOLDLOCK)", StringComparison.Ordinal))
            {
                if (Interlocked.Increment(ref arrivals) == 2) ready.TrySetResult();
                await ready.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            }
            return result;
        }
    }
}

public sealed class WelcomeGiftSqlServerDatabase : IAsyncLifetime
{
    private string? connectionString;
    public int FirstUserId { get; private set; }
    public int SecondUserId { get; private set; }

    public async Task InitializeAsync()
    {
        var configured = Environment.GetEnvironmentVariable(SqlServerWalletFactAttribute.ConnectionVariable);
        if (string.IsNullOrWhiteSpace(configured)) return;
        connectionString = new SqlConnectionStringBuilder(configured)
        {
            InitialCatalog = $"KoochWelcomeGift_{Guid.NewGuid():N}",
            Pooling = false, TrustServerCertificate = true
        }.ConnectionString;
        await using var db = NewContext();
        await db.Database.EnsureCreatedAsync();
        var first = new User { FirstName = "First", LastName = "User", PhoneNumber = "09120000001", Role = UserRole.Client, PendingRegistrationNationalCode = "1234567891" };
        var second = new User { FirstName = "Second", LastName = "User", PhoneNumber = "09120000002", Role = UserRole.Client, PendingRegistrationNationalCode = "1234567881" };
        db.Users.AddRange(first, second);
        db.WelcomeGiftCampaigns.Add(new WelcomeGiftCampaign
        {
            Title = "Welcome", Amount = 100m,
            StartDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
            EndDate = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)),
            MaxRecipients = 1, ValidityDays = 30, IsActive = true
        });
        await db.SaveChangesAsync();
        FirstUserId = first.Id;
        SecondUserId = second.Id;
    }

    public KoochDbContext NewContext(params IInterceptor[] interceptors) => new(new DbContextOptionsBuilder<KoochDbContext>()
        .UseSqlServer(connectionString ?? throw new InvalidOperationException("SQL Server test database is unavailable."),
            options => options.CommandTimeout(30)).AddInterceptors(interceptors).Options);

    public async Task DisposeAsync()
    {
        if (connectionString is null) return;
        await using var db = NewContext();
        await db.Database.EnsureDeletedAsync();
    }
}
