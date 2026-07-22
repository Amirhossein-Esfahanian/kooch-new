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
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class UserIdentityStandardizationTests
{
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
            Email = "   ",
            Password = "password1",
            ConfirmPassword = "password1"
        });

        var user = await database.Context.Users.SingleAsync();
        Assert.Equal("Ali", user.FirstName);
        Assert.Equal("Rezaei", user.LastName);
        Assert.Equal("09121234567", user.PhoneNumber);
        Assert.Null(user.Email);
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
            Password = "password1",
            ConfirmPassword = "password1"
        }));

        Assert.Equal(UserIdentityNormalization.DuplicatePhoneNumberMessage, exception.Message);
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
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new KoochDbContext(options);
        await context.Database.EnsureCreatedAsync();
        return new TestDatabase(connection, context);
    }

    private static AuthService CreateAuthService(KoochDbContext dbContext)
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
            new TestHostEnvironment(),
            new RecordingNotificationService());
    }

    private static AdminUserService CreateAdminUserService(KoochDbContext dbContext)
    {
        var authorization = new PropertyAccessService(dbContext);
        return new AdminUserService(
            dbContext,
            new PermissionService(dbContext, authorization),
            null!,
            null!);
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
