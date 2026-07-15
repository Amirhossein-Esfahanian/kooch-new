using Kooch.Api.Data;
using Kooch.Api.Entities;
using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class CanonicalOwnerMembershipMigrationTests
{
    [Fact]
    public void BackfillMigration_AppliesConfirmedOwnershipMappingOnly()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var operation = Assert.Single(migration.UpOperations.OfType<SqlOperation>());
        var sql = operation.Sql;

        Assert.Contains("WHEN 5 THEN 1011", sql);
        Assert.Contains("WHEN 1006 THEN 1004", sql);
        Assert.Contains("Id IN (1, 2, 3, 4, 1005) AND OwnerId <> 1", sql);
        Assert.Contains("Id = 5 AND OwnerId NOT IN (1, 1011)", sql);
        Assert.Contains("Id = 1006 AND OwnerId NOT IN (1, 1004)", sql);
        Assert.DoesNotContain("UPDATE Users", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackfillMigration_CanonicalizesOnlyTheMatchingOwnerMembership()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("property.OwnerId = access.UserId", sql);
        Assert.Contains("SET access.PropertyRole = 0", sql);
        Assert.Contains("access.Status = 1", sql);
        Assert.Contains("access.IsActive = 1", sql);
        Assert.Contains("THEN access.PermissionMatrixJson", sql);
        Assert.Contains("ELSE @OwnerPermissionMatrix", sql);
        Assert.Contains("\"Dashboard\":{\"View\":true", sql);
        Assert.Contains("\"Settings\":{\"View\":true", sql);
        Assert.Contains("WHERE NOT EXISTS", sql);
        Assert.DoesNotContain("DELETE FROM UserPropertyAccesses", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackfillMigration_IsRepeatableAndFailsClearlyOnInvalidState()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var upSql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;
        var downSql = Assert.Single(migration.DownOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("THROW 51000", upSql);
        Assert.Contains("THROW 51001", upSql);
        Assert.Contains("THROW 51002", upSql);
        Assert.Contains("different active PropertyOwner membership", upSql);
        Assert.Contains("THROW 51003", upSql);
        Assert.Contains("THROW 51004", upSql);
        Assert.Contains("THROW 51005", upSql);
        Assert.Contains("THROW 51006", upSql);
        Assert.Contains("NOT EXISTS", upSql);
        Assert.Contains("User 1011 global IsActive=", upSql);
        Assert.Contains("account status was not changed", upSql);
        Assert.Contains("THROW 51009", downSql);
        Assert.Contains("intentionally irreversible", downSql);
        Assert.DoesNotContain("DELETE FROM", downSql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MembershipModel_EnforcesOneMembershipPerUserAndProperty()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;
        using var dbContext = new KoochDbContext(options);
        var membership = dbContext.Model.FindEntityType(typeof(UserPropertyAccess));

        var index = Assert.Single(membership!.GetIndexes(), candidate =>
            candidate.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(UserPropertyAccess.UserId), nameof(UserPropertyAccess.PropertyId)]));
        Assert.True(index.IsUnique);
    }
}
