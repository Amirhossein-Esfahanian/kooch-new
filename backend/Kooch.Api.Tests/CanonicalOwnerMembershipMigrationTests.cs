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
    public void BackfillMigration_DoesNotUseDataSpecificOwnershipMappings()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var operation = Assert.Single(migration.UpOperations.OfType<SqlOperation>());
        var sql = operation.Sql;

        Assert.DoesNotContain("@DemoOwnerMappings", sql);
        Assert.DoesNotContain("Slug", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("admin@kooch.local", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("demo-owner@kooch.local", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("WHEN 5 THEN 1011", sql);
        Assert.DoesNotContain("WHEN 1006 THEN 1004", sql);
        Assert.DoesNotContain("Id IN (1, 2, 3, 4, 1005)", sql);
        Assert.DoesNotContain("Id = 5", sql);
        Assert.DoesNotContain("Id = 1006", sql);
        Assert.DoesNotContain("Id = 1004", sql);
        Assert.DoesNotContain("Id = 1005", sql);
        Assert.DoesNotContain("Id = 1006", sql);
        Assert.DoesNotContain("Id = 1011", sql);
        Assert.DoesNotContain("(1004)", sql);
        Assert.DoesNotContain("(1005)", sql);
        Assert.DoesNotContain("(1006)", sql);
        Assert.DoesNotContain("(1011)", sql);
        Assert.DoesNotContain("SET OwnerId", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE Properties", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE property", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE Users", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackfillMigration_ValidatesExistingPropertyOwnerReferences()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("DECLARE @MissingOwners", sql);
        Assert.Contains("LEFT JOIN Users AS owner", sql);
        Assert.Contains("owner.Id = property.OwnerId", sql);
        Assert.Contains("owner.IsDeleted = 0", sql);
        Assert.Contains("property.IsDeleted = 0", sql);
        Assert.Contains("owner.Id IS NULL", sql);
        Assert.Contains("THROW 51001", sql);
        Assert.Contains("Property.OwnerId user is missing or deleted", sql);
    }

    [Fact]
    public void BackfillMigration_RepairsOrCreatesCanonicalOwnerMemberships()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("property.OwnerId = access.UserId", sql);
        Assert.Contains("SET access.PropertyRole = 0", sql);
        Assert.Contains("access.Status = 1", sql);
        Assert.Contains("access.IsActive = 1", sql);
        Assert.Contains("INSERT INTO UserPropertyAccesses", sql);
        Assert.Contains("property.OwnerId", sql);
        Assert.Contains("property.Id", sql);
        Assert.Contains("AND NOT EXISTS", sql);
        Assert.DoesNotContain("DELETE FROM UserPropertyAccesses", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackfillMigration_PreservesValidPermissionMatrixAndFallsBackOnlyWhenInvalid()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("ISJSON(access.PermissionMatrixJson) = 1", sql);
        Assert.Contains("THEN access.PermissionMatrixJson", sql);
        Assert.Contains("ELSE @OwnerPermissionMatrix", sql);
        Assert.Contains("\"Dashboard\":{\"View\":true", sql);
        Assert.Contains("\"Settings\":{\"View\":true", sql);
    }

    [Fact]
    public void BackfillMigration_FailsFastAndVerifiesExactlyOneCanonicalOwnerMembership()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var upSql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;
        var downSql = Assert.Single(migration.DownOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("different active PropertyOwner membership", upSql);
        Assert.Contains("THROW 51003", upSql);
        Assert.Contains("THROW 51004", upSql);
        Assert.Contains("SELECT COUNT(*)", upSql);
        Assert.Contains(") <> 1", upSql);
        Assert.Contains("THROW 51005", upSql);
        Assert.Contains("canonical owner memberships verified", upSql);
        Assert.Contains("THROW 51009", downSql);
        Assert.Contains("intentionally irreversible", downSql);
        Assert.DoesNotContain("DELETE FROM", downSql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void BackfillMigration_CanSafelyNoOpOnAnEmptyDatabase()
    {
        var migration = new BackfillCanonicalOwnerMemberships();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.DoesNotContain("mapped property is missing", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("FROM (VALUES", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("required.Id", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("FROM Properties AS property", sql);
        Assert.Contains("WHERE property.IsDeleted = 0", sql);
        Assert.Contains("SELECT COUNT(*)", sql);
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
