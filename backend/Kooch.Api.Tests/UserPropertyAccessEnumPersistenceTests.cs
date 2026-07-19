using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class UserPropertyAccessEnumPersistenceTests
{
    [Theory]
    [InlineData(PropertyUserRole.PropertyOwner, PropertyUserStatus.Pending)]
    [InlineData(PropertyUserRole.Manager, PropertyUserStatus.Active)]
    public async Task MembershipRoleAndStatus_RoundTripThroughRelationalProvider(
        PropertyUserRole role,
        PropertyUserStatus status)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var setupContext = new KoochDbContext(options))
        {
            await setupContext.Database.EnsureCreatedAsync();

            var owner = new User
            {
                FirstName = "Enum",
                LastName = "Owner",
                Email = "enum-owner@example.com",
                PasswordHash = "hash",
                Role = UserRole.Client,
                IsActive = true
            };
            var destination = new Destination
            {
                Name = "Enum Destination",
                Slug = "enum-destination"
            };
            var property = new Property
            {
                Owner = owner,
                Destination = destination,
                Name = "Enum Property",
                Slug = "enum-property"
            };
            setupContext.UserPropertyAccesses.Add(new UserPropertyAccess
            {
                User = owner,
                Property = property,
                PropertyRole = role,
                Status = status,
                IsActive = status == PropertyUserStatus.Active
            });

            await setupContext.SaveChangesAsync();
        }

        await using var verificationContext = new KoochDbContext(options);
        var persisted = await verificationContext.UserPropertyAccesses
            .AsNoTracking()
            .SingleAsync();

        Assert.Equal(role, persisted.PropertyRole);
        Assert.Equal(status, persisted.Status);
    }
}
