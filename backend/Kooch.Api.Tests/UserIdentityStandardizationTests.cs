using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Admin;
using Kooch.Api.Dtos.Auth;
using Kooch.Api.Dtos.PropertyUsers;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Kooch.Api.Utilities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class UserIdentityStandardizationTests
{
    private const string ValidNationalCode = "1234567891";

    [Fact]
    public async Task AuthRegister_CreatesUserWithoutEmailAndNormalizesIdentity()
    {
        await using var database = await CreateDatabaseAsync();
        var service = CreateAuthService(database.Context);

        await service.RegisterAsync(new RegisterRequest
        {
            FirstName = "  Ali  ",
            LastName = "  Rezaei  ",
            Mobile = "+989121234567",
            NationalCode = "۱۲۳۴۵۶۷۸۹۱",
            Email = "   ",
            Password = "password1",
            ConfirmPassword = "password1"
        });

        var user = await database.Context.Users.SingleAsync();
        Assert.Equal("Ali", user.FirstName);
        Assert.Equal("Rezaei", user.LastName);
        Assert.Equal("09121234567", user.PhoneNumber);
        Assert.Null(user.Email);
        Assert.Equal(ValidNationalCode, user.PendingRegistrationNationalCode);
    }

    [Fact]
    public async Task AuthRegister_RejectsDuplicatePhoneAcrossFormats()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Users.Add(CreateUser(1, UserRole.Client, "existing", "09121234567", "existing@example.test"));
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => service.RegisterAsync(new RegisterRequest
        {
            FirstName = "New",
            LastName = "Client",
            Mobile = "00989121234567",
            NationalCode = ValidNationalCode,
            Password = "password1",
            ConfirmPassword = "password1"
        }));

        Assert.Equal(UserIdentityNormalization.DuplicatePhoneNumberMessage, exception.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("1234567890")]
    [InlineData("123456789A")]
    public async Task AuthRegister_RequiresValidNationalCodeBeforeCreatingUser(string? nationalCode)
    {
        await using var database = await CreateDatabaseAsync();
        var service = CreateAuthService(database.Context);

        await Assert.ThrowsAsync<ArgumentException>(() => service.RegisterAsync(new RegisterRequest
        {
            FirstName = "New", LastName = "Client", Mobile = "09121234567",
            NationalCode = nationalCode!, Password = "password1", ConfirmPassword = "password1"
        }));

        Assert.Empty(database.Context.Users);
        Assert.Empty(database.Context.MobileOtpCodes);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("1234567890")]
    public async Task CheckoutOtp_RequiresValidNationalCodeBeforeCreatingUser(string? nationalCode)
    {
        await using var database = await CreateDatabaseAsync();
        var service = CreateAuthService(database.Context);

        await Assert.ThrowsAsync<ArgumentException>(() => service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09121234567", AllowRegistration = true,
            FirstName = "New", LastName = "Client", NationalCode = nationalCode
        }));

        Assert.Empty(database.Context.Users);
        Assert.Empty(database.Context.MobileOtpCodes);
    }

    [Fact]
    public async Task CheckoutOtp_RequestsIdentityBeforeCreatingANewUser()
    {
        await using var database = await CreateDatabaseAsync();
        var service = CreateAuthService(database.Context);

        var response = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "۰۹۱۲۱۲۳۴۵۶۷",
            AllowRegistration = true
        });

        Assert.False(response.Sent);
        Assert.True(response.RequiresRegistration);
        Assert.Null(response.ExpiresAtUtc);
        Assert.Empty(database.Context.Users);
        Assert.Empty(database.Context.MobileOtpCodes);
    }

    [Fact]
    public async Task CheckoutOtp_CreatesAndAuthenticatesNewUserThroughExistingOtpFlow()
    {
        await using var database = await CreateDatabaseAsync();
        var service = CreateAuthService(database.Context, Environments.Development);

        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "+989121234567",
            AllowRegistration = true,
            FirstName = "  Ali  ",
            LastName = "  Rezaei  ",
            NationalCode = "۱۲۳۴۵۶۷۸۹۱",
            Email = " ALI@EXAMPLE.TEST "
        });

        Assert.True(requested.Sent);
        Assert.False(requested.RequiresRegistration);
        Assert.NotNull(requested.ExpiresAtUtc);
        Assert.False(string.IsNullOrWhiteSpace(requested.DevOtpCode));

        var user = await database.Context.Users.SingleAsync();
        Assert.Equal("Ali", user.FirstName);
        Assert.Equal("Rezaei", user.LastName);
        Assert.Equal("09121234567", user.PhoneNumber);
        Assert.Equal("ali@example.test", user.Email);
        Assert.False(user.IsActive);
        Assert.Equal(ValidNationalCode, user.PendingRegistrationNationalCode);
        Assert.False(string.IsNullOrWhiteSpace(user.PasswordHash));

        var authenticated = await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "۰۹۱۲۱۲۳۴۵۶۷",
            Code = requested.DevOtpCode!
        });

        Assert.NotNull(authenticated);
        Assert.Equal(user.Id, authenticated.UserId);
        Assert.True((await database.Context.Users.SingleAsync()).IsActive);
        Assert.Null((await database.Context.Users.SingleAsync()).PendingRegistrationNationalCode);
    }

    [Fact]
    public async Task CheckoutOtp_ReusesExistingUserAndKeepsCooldown()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Users.Add(
            CreateUser(1, UserRole.Client, "existing", "09121234567", null));
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context);

        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "00989121234567",
            AllowRegistration = true
        });

        Assert.True(requested.Sent);
        Assert.False(requested.RequiresRegistration);
        Assert.Single(database.Context.Users);
        Assert.Null((await database.Context.Users.SingleAsync()).PendingRegistrationNationalCode);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.RequestOtpAsync(new RequestOtpRequest
            {
                Mobile = "09121234567",
                AllowRegistration = true,
                NationalCode = ValidNationalCode
            }));
        Assert.Null((await database.Context.Users.SingleAsync()).PendingRegistrationNationalCode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ExistingUser_OtpRequestNeverCreatesRegistrationIntent(bool isActive)
    {
        await using var database = await CreateDatabaseAsync();
        var user = CreateUser(1, UserRole.Client, "existing", "09121234567", null);
        user.IsActive = isActive;
        database.Context.Users.Add(user);
        await database.Context.SaveChangesAsync();

        var requested = await CreateAuthService(database.Context).RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09121234567", AllowRegistration = true,
            FirstName = "Another", LastName = "Identity", NationalCode = ValidNationalCode
        });

        Assert.True(requested.Sent);
        Assert.Single(await database.Context.Users.ToListAsync());
        Assert.Null(user.PendingRegistrationNationalCode);
        Assert.Equal("existing", user.FirstName);
    }

    [Fact]
    public async Task PendingRegistration_OtpReissuePreservesOriginalNationalCode()
    {
        await using var database = await CreateDatabaseAsync();
        var service = CreateAuthService(database.Context);
        await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09121234567", AllowRegistration = true,
            FirstName = "New", LastName = "Client", NationalCode = ValidNationalCode
        });
        await database.Context.MobileOtpCodes.ExecuteUpdateAsync(setters => setters
            .SetProperty(otp => otp.CreatedAtUtc, DateTime.UtcNow.AddMinutes(-2)));

        var reissued = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09121234567", AllowRegistration = true,
            FirstName = "Changed", LastName = "Name", NationalCode = "0012345679"
        });

        Assert.True(reissued.Sent);
        Assert.Equal(2, await database.Context.MobileOtpCodes.CountAsync());
        var user = await database.Context.Users.SingleAsync();
        Assert.Equal(ValidNationalCode, user.PendingRegistrationNationalCode);
        Assert.Equal("New", user.FirstName);
    }

    [Fact]
    public async Task VerifiedNewRegistration_GrantsOnceAndConsumesPendingIntent()
    {
        await using var database = await CreateDatabaseAsync();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            DateTimeOffset.UtcNow, IranSiteTime.BusinessTimeZone).DateTime);
        database.Context.WelcomeGiftCampaigns.Add(new WelcomeGiftCampaign
        {
            Title = "Welcome", Amount = 100m, StartDate = today, EndDate = today,
            MaxRecipients = 1, ValidityDays = 30, IsActive = true
        });
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context, Environments.Development);
        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09121234567", AllowRegistration = true,
            FirstName = "New", LastName = "Client", NationalCode = ValidNationalCode
        });
        Assert.Empty(await database.Context.WelcomeGiftGrants.ToListAsync());

        Assert.Null(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09121234567", Code = "000000"
        }));
        Assert.Equal(ValidNationalCode,
            (await database.Context.Users.SingleAsync()).PendingRegistrationNationalCode);
        Assert.NotNull(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09121234567", Code = requested.DevOtpCode!
        }));
        Assert.Null(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09121234567", Code = requested.DevOtpCode!
        }));

        var user = await database.Context.Users.SingleAsync();
        var grant = Assert.Single(await database.Context.WelcomeGiftGrants.ToListAsync());
        Assert.True(user.IsActive);
        Assert.Null(user.PendingRegistrationNationalCode);
        Assert.Equal((user.Id, ValidNationalCode), (grant.UserId, grant.NationalCodeSnapshot));
        Assert.Single(await database.Context.WalletLots.ToListAsync());
        Assert.Single(await database.Context.WalletEntries.ToListAsync());
        Assert.Equal(1, (await database.Context.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("inactive")]
    [InlineData("future")]
    [InlineData("ended")]
    [InlineData("exhausted")]
    public async Task NoQualifyingCampaign_RegistrationSucceedsAndLaterLoginCannotGrant(string reason)
    {
        await using var database = await CreateDatabaseAsync();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            DateTimeOffset.UtcNow, IranSiteTime.BusinessTimeZone).DateTime);
        WelcomeGiftCampaign? campaign = null;
        if (reason != "missing")
        {
            campaign = new WelcomeGiftCampaign
            {
                Title = "Welcome", Amount = 100m,
                StartDate = reason == "future" ? today.AddDays(1) : today.AddDays(-1),
                EndDate = reason == "ended" ? today.AddDays(-1) : today.AddDays(2),
                MaxRecipients = 1, GrantedCount = reason == "exhausted" ? 1 : 0,
                ValidityDays = 30, IsActive = reason != "inactive"
            };
            database.Context.WelcomeGiftCampaigns.Add(campaign);
            await database.Context.SaveChangesAsync();
        }
        var service = CreateAuthService(database.Context, Environments.Development);
        var requested = await service.RegisterAsync(new RegisterRequest
        {
            FirstName = "New", LastName = "Client", Mobile = "09121234567",
            NationalCode = ValidNationalCode, Password = "password1", ConfirmPassword = "password1"
        });

        Assert.NotNull(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09121234567", Code = requested.DevOtpCode!
        }));
        Assert.Null((await database.Context.Users.SingleAsync()).PendingRegistrationNationalCode);
        Assert.Empty(await database.Context.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await database.Context.WalletEntries.ToListAsync());

        // A campaign becoming eligible later must not turn a login into registration.
        if (campaign is null)
        {
            campaign = new WelcomeGiftCampaign { Title = "Later", Amount = 100m, ValidityDays = 30 };
            database.Context.WelcomeGiftCampaigns.Add(campaign);
        }
        campaign.IsActive = true;
        campaign.StartDate = today;
        campaign.EndDate = today;
        campaign.MaxRecipients = campaign.GrantedCount + 1;
        var grantedCount = campaign.GrantedCount;
        await database.Context.SaveChangesAsync();

        await using (var loginContext = database.NewContext())
        {
            var login = CreateAuthService(loginContext, Environments.Development);
            Assert.NotNull(await login.LoginAsync(new LoginRequest
            {
                Identifier = "09121234567", Password = "password1"
            }));
            var loginOtp = await login.RequestOtpAsync(new RequestOtpRequest
            {
                Mobile = "09121234567", AllowRegistration = true, NationalCode = "0012345679"
            });
            Assert.NotNull(await login.VerifyOtpAsync(new VerifyOtpRequest
            {
                Mobile = "09121234567", Code = loginOtp.DevOtpCode!
            }));
            Assert.Null(await login.VerifyOtpAsync(new VerifyOtpRequest
            {
                Mobile = "09121234567", Code = loginOtp.DevOtpCode!
            }));
        }

        await using var persisted = database.NewContext();
        Assert.Null((await persisted.Users.SingleAsync()).PendingRegistrationNationalCode);
        Assert.Empty(await persisted.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await persisted.WalletAccounts.ToListAsync());
        Assert.Empty(await persisted.WalletLots.ToListAsync());
        Assert.Empty(await persisted.WalletEntries.ToListAsync());
        Assert.Equal(grantedCount, (await persisted.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public async Task ExistingOrPreMigrationUser_OtpNeverGrantsWelcomeGift(
        bool isActive, bool hasStalePendingIntent)
    {
        await using var database = await CreateDatabaseAsync();
        var user = CreateUser(1, UserRole.Client, "existing", "09121234567", null);
        user.IsActive = isActive;
        user.PendingRegistrationNationalCode = hasStalePendingIntent ? ValidNationalCode : null;
        database.Context.Users.Add(user);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            DateTimeOffset.UtcNow, IranSiteTime.BusinessTimeZone).DateTime);
        database.Context.WelcomeGiftCampaigns.Add(new WelcomeGiftCampaign
        {
            Title = "Welcome", Amount = 100m, StartDate = today, EndDate = today,
            MaxRecipients = 1, ValidityDays = 30, IsActive = true
        });
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context, Environments.Development);
        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09121234567", AllowRegistration = true,
            NationalCode = ValidNationalCode
        });

        Assert.NotNull(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09121234567", Code = requested.DevOtpCode!
        }));
        Assert.Null(user.PendingRegistrationNationalCode);
        Assert.Empty(await database.Context.WelcomeGiftGrants.ToListAsync());
        Assert.Empty(await database.Context.WalletEntries.ToListAsync());
        Assert.Equal(0, (await database.Context.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    [Theory]
    [InlineData("credit")]
    [InlineData("grant")]
    [InlineData("intent")]
    public async Task GrantWriteFailure_RollsBackEverythingAndFreshOtpRetryGrantsExactlyOnce(string phase)
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Guests.Add(new Guest
        {
            FirstName = "Existing", LastName = "Guest", NormalizedMobile = "09121234567"
        });
        await database.Context.SaveChangesAsync();
        var guestId = (await database.Context.Guests.SingleAsync()).Id;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            DateTimeOffset.UtcNow, IranSiteTime.BusinessTimeZone).DateTime);
        database.Context.WelcomeGiftCampaigns.Add(new WelcomeGiftCampaign
        {
            Title = "Welcome", Amount = 100m, StartDate = today, EndDate = today,
            MaxRecipients = 1, ValidityDays = 30, IsActive = true
        });
        await database.Context.SaveChangesAsync();
        var registration = CreateAuthService(database.Context, Environments.Development);
        var requested = await registration.RegisterAsync(new RegisterRequest
        {
            FirstName = "New", LastName = "Client", Mobile = "09121234567",
            NationalCode = ValidNationalCode, Password = "password1", ConfirmPassword = "password1"
        });
        var failure = new GrantWriteFailure(phase);
        var verification = new VerifyOtpRequest
        {
            Mobile = "09121234567", Code = requested.DevOtpCode!
        };
        await using (var failedRequest = database.NewContext(failure))
        {
            await Assert.ThrowsAsync<DbUpdateException>(() =>
                CreateAuthService(failedRequest).VerifyOtpAsync(verification));
        }
        Assert.True(failure.WasTriggered);

        await using (var rolledBack = database.NewContext())
        {
            Assert.False((await rolledBack.Users.SingleAsync()).IsActive);
            Assert.Equal(ValidNationalCode,
                (await rolledBack.Users.SingleAsync()).PendingRegistrationNationalCode);
            Assert.Null((await rolledBack.MobileOtpCodes.SingleAsync()).UsedAtUtc);
            Assert.Null((await rolledBack.Guests.SingleAsync()).UserId);
            Assert.Empty(await rolledBack.WelcomeGiftGrants.ToListAsync());
            Assert.Empty(await rolledBack.WalletAccounts.ToListAsync());
            Assert.Empty(await rolledBack.WalletLots.ToListAsync());
            Assert.Empty(await rolledBack.WalletEntries.ToListAsync());
            Assert.Equal(0, (await rolledBack.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
        }

        await using (var retry = database.NewContext())
        {
            var response = await CreateAuthService(retry).VerifyOtpAsync(verification);
            Assert.NotNull(response);
            Assert.Equal(guestId, response.GuestId);
        }
        await using (var replay = database.NewContext())
            Assert.Null(await CreateAuthService(replay).VerifyOtpAsync(verification));

        await using var persisted = database.NewContext();
        var user = await persisted.Users.SingleAsync();
        var grant = Assert.Single(await persisted.WelcomeGiftGrants.ToListAsync());
        var account = Assert.Single(await persisted.WalletAccounts.ToListAsync());
        var lot = Assert.Single(await persisted.WalletLots.ToListAsync());
        var entry = Assert.Single(await persisted.WalletEntries.ToListAsync());
        Assert.True(user.IsActive);
        Assert.Null(user.PendingRegistrationNationalCode);
        Assert.NotNull((await persisted.MobileOtpCodes.SingleAsync()).UsedAtUtc);
        Assert.Equal(user.Id, (await persisted.Guests.SingleAsync()).UserId);
        Assert.Equal(user.Id, grant.UserId);
        Assert.Equal(ValidNationalCode, grant.NationalCodeSnapshot);
        Assert.Equal(user.Id, account.UserId);
        Assert.Equal(account.Id, lot.WalletAccountId);
        Assert.Equal(account.Id, entry.WalletAccountId);
        Assert.Equal(lot.Id, entry.WalletLotId);
        Assert.Equal(lot.Id, grant.WalletLotId);
        Assert.Equal(entry.Id, grant.WalletEntryId);
        Assert.Equal(WalletEntryDirection.Credit, entry.Direction);
        Assert.Equal(100m, entry.Amount);
        Assert.Equal(entry.Amount, grant.AmountSnapshot);
        Assert.False(lot.IsWithdrawable);
        Assert.Equal(1, (await persisted.WelcomeGiftCampaigns.SingleAsync()).GrantedCount);
    }

    [Fact]
    public async Task Registration_DoesNotClaimGuestByUnverifiedEmailOrBeforeMobileOtp()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Guests.Add(new Guest
        {
            FirstName = "Victim", LastName = "Guest", Mobile = "09120000001",
            NormalizedMobile = "09120000001", Email = "victim@example.test",
            NormalizedEmail = "victim@example.test"
        });
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context, Environments.Development);

        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09120000002", AllowRegistration = true,
            FirstName = "Attacker", LastName = "Client", Email = "victim@example.test",
            NationalCode = ValidNationalCode
        });

        Assert.Null((await database.Context.Guests.SingleAsync()).UserId);
        Assert.Null(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09120000002", Code = "000000"
        }));
        Assert.Null((await database.Context.Guests.SingleAsync()).UserId);

        var verified = await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09120000002", Code = requested.DevOtpCode!
        });
        Assert.NotNull(verified);
        var victim = await database.Context.Guests.SingleAsync(guest => guest.NormalizedMobile == "09120000001");
        Assert.Null(victim.UserId);
        Assert.NotEqual(victim.Id, verified.GuestId);
    }

    [Fact]
    public async Task VerifiedMatchingMobile_ClaimsOnlyAfterOtpAndCannotBeReplayed()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Guests.Add(new Guest
        {
            FirstName = "Existing", LastName = "Guest", Mobile = "09120000003",
            NormalizedMobile = "09120000003"
        });
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context, Environments.Development);
        var requested = await service.RegisterAsync(new RegisterRequest
        {
            FirstName = "New", LastName = "Client", Mobile = "09120000003",
            NationalCode = ValidNationalCode,
            Password = "password1", ConfirmPassword = "password1"
        });
        var guest = await database.Context.Guests.SingleAsync();
        Assert.Null(guest.UserId);

        var verified = await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09120000003", Code = requested.DevOtpCode!
        });
        Assert.NotNull(verified);
        Assert.Equal(guest.Id, verified.GuestId);
        Assert.Equal(verified.UserId, (await database.Context.Guests.AsNoTracking().SingleAsync()).UserId);
        Assert.Null(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09120000003", Code = requested.DevOtpCode!
        }));
        Assert.Single(await database.Context.Guests.ToListAsync());
    }

    [Fact]
    public async Task ExpiredOtp_DoesNotLinkExistingGuest()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Guests.Add(new Guest
        {
            FirstName = "Existing", LastName = "Guest", NormalizedMobile = "09120000004"
        });
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context, Environments.Development);
        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09120000004", AllowRegistration = true,
            FirstName = "New", LastName = "Client", NationalCode = ValidNationalCode
        });
        var otp = await database.Context.MobileOtpCodes.SingleAsync();
        otp.ExpiresAtUtc = DateTime.UtcNow.AddSeconds(-1);
        await database.Context.SaveChangesAsync();

        Assert.Null(await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09120000004", Code = requested.DevOtpCode!
        }));
        Assert.Null((await database.Context.Guests.SingleAsync()).UserId);
    }

    [Fact]
    public async Task VerifiedMobile_NeverReassignsAnotherUsersGuest()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Users.Add(CreateUser(1, UserRole.Client, "prior", "09120000005", null));
        database.Context.Guests.Add(new Guest
        {
            UserId = 1, FirstName = "Prior", LastName = "Guest",
            NormalizedMobile = "09120000006"
        });
        await database.Context.SaveChangesAsync();
        var service = CreateAuthService(database.Context, Environments.Development);
        var requested = await service.RequestOtpAsync(new RequestOtpRequest
        {
            Mobile = "09120000006", AllowRegistration = true,
            FirstName = "New", LastName = "Client", NationalCode = ValidNationalCode
        });

        var verified = await service.VerifyOtpAsync(new VerifyOtpRequest
        {
            Mobile = "09120000006", Code = requested.DevOtpCode!
        });
        Assert.NotNull(verified);
        Assert.Equal(1, (await database.Context.Guests.SingleAsync(guest => guest.FirstName == "Prior")).UserId);
        Assert.NotEqual(1, verified.UserId);
        Assert.NotEqual(1, verified.GuestId);
    }

    [Fact]
    public async Task PasswordLogin_DoesNotLinkAnExistingGuestByUnverifiedContact()
    {
        await using var database = await CreateDatabaseAsync();
        var user = CreateUser(1, UserRole.Client, "new", "09120000007", "shared@example.test");
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword("password1");
        database.Context.Users.Add(user);
        database.Context.Guests.Add(new Guest
        {
            FirstName = "Other", LastName = "Guest",
            NormalizedMobile = "09120000008", NormalizedEmail = "shared@example.test"
        });
        await database.Context.SaveChangesAsync();

        var login = await CreateAuthService(database.Context).LoginAsync(new LoginRequest
        {
            Identifier = "09120000007", Password = "password1"
        });

        Assert.NotNull(login);
        Assert.Null(login.GuestId);
        Assert.Null((await database.Context.Guests.SingleAsync()).UserId);
    }

    [Fact]
    public async Task ConcurrentOtpVerification_CannotClaimGuestTwice()
    {
        var connectionString = $"Data Source=guest-link-{Guid.NewGuid():N};Mode=Memory;Cache=Shared;Default Timeout=30";
        await using var keeper = new SqliteConnection(connectionString);
        await keeper.OpenAsync();
        SqliteTestFunctions.RegisterLen(keeper);
        var keeperOptions = new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(keeper).Options;
        await using (var setup = new KoochDbContext(keeperOptions))
        {
            await setup.Database.EnsureCreatedAsync();
            setup.Guests.Add(new Guest
            {
                FirstName = "Existing", LastName = "Guest", NormalizedMobile = "09120000009"
            });
            await setup.SaveChangesAsync();
            var requested = await CreateAuthService(setup, Environments.Development)
                .RequestOtpAsync(new RequestOtpRequest
                {
                    Mobile = "09120000009", AllowRegistration = true,
                    FirstName = "New", LastName = "Client", NationalCode = ValidNationalCode
                });

            async Task<AuthResponse?> VerifyAsync()
            {
                await using var connection = new SqliteConnection(connectionString);
                await connection.OpenAsync();
                SqliteTestFunctions.RegisterLen(connection);
                await using var context = new KoochDbContext(
                    new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection).Options);
                return await CreateAuthService(context).VerifyOtpAsync(new VerifyOtpRequest
                {
                    Mobile = "09120000009", Code = requested.DevOtpCode!
                });
            }

            var outcomes = await Task.WhenAll(VerifyAsync(), VerifyAsync());
            Assert.Single(outcomes, outcome => outcome is not null);
            var guest = await setup.Guests.AsNoTracking().SingleAsync();
            Assert.Equal(outcomes.Single(outcome => outcome is not null)!.UserId, guest.UserId);
            Assert.Single(await setup.Guests.AsNoTracking().ToListAsync());
        }
    }

    [Fact]
    public async Task AdminCreate_NormalizesNamesPhoneEmailAndAllowsMissingEmail()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Users.Add(CreateUser(1, UserRole.SuperAdmin, "admin", "09120000001", "admin@example.test"));
        await database.Context.SaveChangesAsync();
        var service = CreateAdminUserService(database.Context);

        var createdWithEmail = await service.CreateUserAsync(1, UserRole.SuperAdmin, new AdminUserRequest
        {
            FirstName = "  Admin  ",
            LastName = "  Helper  ",
            Email = "HELPER@EXAMPLE.TEST",
            PhoneNumber = "+989121111111",
            Password = "password1",
            Role = UserRole.AdminAssistant
        });
        var createdWithoutEmail = await service.CreateUserAsync(1, UserRole.SuperAdmin, new AdminUserRequest
        {
            FirstName = "  No  ",
            LastName = "  Email  ",
            Email = " ",
            PhoneNumber = "00989122222222",
            Password = "password1",
            Role = UserRole.AdminAssistant
        });

        var withEmail = await database.Context.Users.SingleAsync(user => user.Id == createdWithEmail.Id);
        var withoutEmail = await database.Context.Users.SingleAsync(user => user.Id == createdWithoutEmail.Id);
        Assert.Equal("Admin", withEmail.FirstName);
        Assert.Equal("Helper", withEmail.LastName);
        Assert.Equal("helper@example.test", withEmail.Email);
        Assert.Equal("09121111111", withEmail.PhoneNumber);
        Assert.Null(withoutEmail.Email);
        Assert.Equal("09122222222", withoutEmail.PhoneNumber);
    }

    [Fact]
    public async Task AdminCreate_RejectsDuplicateEmailIgnoringCase()
    {
        await using var database = await CreateDatabaseAsync();
        database.Context.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "admin", "09120000001", "admin@example.test"),
            CreateUser(2, UserRole.AdminAssistant, "existing", "09120000002", "duplicate@example.test"));
        await database.Context.SaveChangesAsync();
        var service = CreateAdminUserService(database.Context);

        var exception = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateUserAsync(
            1,
            UserRole.SuperAdmin,
            new AdminUserRequest
            {
                FirstName = "Other",
                LastName = "Admin",
                Email = "DUPLICATE@EXAMPLE.TEST",
                PhoneNumber = "09120000003",
                Password = "password1",
                Role = UserRole.AdminAssistant
            }));

        Assert.Equal(UserIdentityNormalization.DuplicateEmailMessage, exception.Message);
    }

    [Fact]
    public async Task PropertyUserCreate_NormalizesOwnerFlowIdentityWithoutEmail()
    {
        await using var database = await CreateDatabaseAsync();
        SeedProperty(database.Context);
        await database.Context.SaveChangesAsync();
        var service = CreatePropertyUserService(database.Context);

        var created = await service.CreateUserAsync(1, UserRole.SuperAdmin, 100, new PropertyUserRequest
        {
            FullName = "  Property Staff  ",
            Mobile = "+989123333333",
            Email = " ",
            Role = PropertyUserRole.Reception,
            Status = PropertyUserStatus.Pending,
            IsActive = false
        });

        var user = await database.Context.Users.SingleAsync(user => user.Id == created.UserId);
        Assert.Equal("Property", user.FirstName);
        Assert.Equal("Staff", user.LastName);
        Assert.Equal("09123333333", user.PhoneNumber);
        Assert.Null(user.Email);
    }

    private static async Task<TestDatabase> CreateDatabaseAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        SqliteTestFunctions.RegisterLen(connection);
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new SqliteTestContext(options);
        await context.Database.EnsureCreatedAsync();
        return new TestDatabase(connection, context);
    }

    private static AuthService CreateAuthService(
        KoochDbContext dbContext,
        string environmentName = "Production",
        IWelcomeGiftGrantService? giftGrantService = null)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new AuthService(
            dbContext,
            Options.Create(new JwtOptions
            {
                Key = "0123456789abcdef0123456789abcdef",
                Issuer = "tests",
                Audience = "tests"
            }),
            authorization,
            new TestHostEnvironment { EnvironmentName = environmentName },
            new RecordingNotificationService(),
            giftGrantService);
    }

    private static AdminUserService CreateAdminUserService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        var permissionService = new PermissionService(dbContext, authorization);
        return new AdminUserService(
            dbContext,
            permissionService,
            null!,
            new AuditLogService(dbContext, permissionService),
            null!,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<AdminUserService>.Instance);
    }

    private sealed class SqliteTestContext(DbContextOptions<KoochDbContext> options)
        : KoochDbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);
            builder.Entity<WalletAccount>().Property(account => account.RowVersion)
                .ValueGeneratedNever();
        }
    }

    private static PropertyUserService CreatePropertyUserService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new PropertyUserService(
            dbContext,
            authorization,
            new StubAuthService(),
            new TestHostEnvironment());
    }

    private static void SeedProperty(KoochDbContext dbContext)
    {
        dbContext.Users.AddRange(
            CreateUser(1, UserRole.SuperAdmin, "super-admin", "09120000001", "admin@example.test"),
            CreateUser(2, UserRole.Client, "property-owner", "09120000002", "owner@example.test"));
        dbContext.Destinations.Add(new Destination
        {
            Id = 10,
            Name = "Kashan",
            Slug = "kashan",
            Country = "Iran"
        });
        dbContext.Properties.Add(new Property
        {
            Id = 100,
            OwnerId = 2,
            DestinationId = 10,
            Name = "Test property",
            Slug = "test-property",
            Description = "Test property",
            Address = "Test address",
            City = "Kashan",
            Country = "Iran",
            Status = PropertyStatus.Approved,
            Type = PropertyType.TraditionalHouse,
            InventoryMode = InventoryMode.NamedRooms
        });
    }

    private static User CreateUser(
        int id,
        UserRole role,
        string identifier,
        string phoneNumber,
        string? email) => new()
    {
        Id = id,
        FirstName = identifier,
        LastName = "user",
        Email = email,
        PhoneNumber = phoneNumber,
        PasswordHash = "not-used",
        Role = role,
        IsActive = true
    };

    private sealed class TestDatabase(SqliteConnection connection, KoochDbContext context) : IAsyncDisposable
    {
        public KoochDbContext Context { get; } = context;

        public KoochDbContext NewContext(params IInterceptor[] interceptors) => new SqliteTestContext(
            new DbContextOptionsBuilder<KoochDbContext>().UseSqlite(connection)
                .AddInterceptors(interceptors).Options);

        public async ValueTask DisposeAsync()
        {
            await Context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private sealed class RecordingNotificationService : INotificationService
    {
        public Task SendAsync(NotificationRequest request, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class GrantWriteFailure(string phase) : SaveChangesInterceptor
    {
        public bool WasTriggered { get; private set; }

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            var context = eventData.Context!;
            var creditSaved = context.ChangeTracker.Entries<WalletEntry>().Any(entry => entry.Entity.Id > 0);
            var grantSaved = context.ChangeTracker.Entries<WelcomeGiftGrant>().Any(entry => entry.Entity.Id > 0);
            var intentConsumed = context.ChangeTracker.Entries<User>()
                .Any(entry => entry.Entity.PendingRegistrationNationalCode is null);
            if (creditSaved && (phase switch
                {
                    "credit" => !grantSaved,
                    "grant" => grantSaved && !intentConsumed,
                    "intent" => grantSaved && intentConsumed,
                    _ => false
                }))
            {
                WasTriggered = true;
                throw new DbUpdateException($"Simulated database failure after {phase} save.");
            }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class StubAuthService : IAuthService
    {
        public Task<string> CreatePasswordSetupTokenAsync(int userId, CancellationToken cancellationToken = default) =>
            Task.FromResult("setup-token");

        public Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public string GenerateJwtToken(User user, DateTime expiresAtUtc) =>
            throw new NotSupportedException();

        public Task<AuthResponse?> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RequestOtpResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<RequestOtpResponse> RequestOtpAsync(RequestOtpRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task SetPasswordAsync(SetPasswordRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<PasswordSetupTokenStatusResponse> ValidatePasswordSetupTokenAsync(string token, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<AuthResponse?> VerifyOtpAsync(VerifyOtpRequest request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Production;
        public string ApplicationName { get; set; } = "Kooch.Api.Tests";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
