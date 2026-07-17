using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class LegacyPropertyUserAccountRoleMigrationTests
{
    [Fact]
    public void Migration_ConvertsOnlyLegacyUserRolesToClient()
    {
        var migration = new MigrateLegacyPropertyUserAccountRoles();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("DECLARE @LegacyOwnerRole int = 2", sql);
        Assert.Contains("DECLARE @LegacyOwnerAssistantRole int = 3", sql);
        Assert.Contains("DECLARE @ClientRole int = 4", sql);
        Assert.Contains("UPDATE Users", sql);
        Assert.Contains("SET Role = @ClientRole", sql);
        Assert.Contains("WHERE Role IN (@LegacyOwnerRole, @LegacyOwnerAssistantRole)", sql);

        Assert.DoesNotContain("UPDATE Properties", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE UserPropertyAccesses", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("INSERT INTO", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET IsActive", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET PasswordSetupRequired", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET OwnerId", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SET PermissionMatrixJson", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Migration_RequiresCanonicalOwnerMembershipBeforeRoleConversion()
    {
        var migration = new MigrateLegacyPropertyUserAccountRoles();
        var sql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("property.OwnerId", sql);
        Assert.Contains("ownerAccount.Role IN (@LegacyOwnerRole, @LegacyOwnerAssistantRole)", sql);
        Assert.Contains("SELECT COUNT(*)", sql);
        Assert.Contains("access.UserId = property.OwnerId", sql);
        Assert.Contains("access.PropertyId = property.Id", sql);
        Assert.Contains("access.PropertyRole = @PropertyOwnerRole", sql);
        Assert.Contains("access.Status = @ActiveMembershipStatus", sql);
        Assert.Contains("access.IsActive = 1", sql);
        Assert.Contains("access.IsDeleted = 0", sql);
        Assert.Contains(") <> 1", sql);
        Assert.Contains("THROW 51020", sql);
        Assert.Contains("missing exactly one active canonical PropertyOwner membership", sql);
    }

    [Fact]
    public void Migration_ReportsConvertedUserIdsAndIsIrreversible()
    {
        var migration = new MigrateLegacyPropertyUserAccountRoles();
        var upSql = Assert.Single(migration.UpOperations.OfType<SqlOperation>()).Sql;
        var downSql = Assert.Single(migration.DownOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("STRING_AGG(CONVERT(nvarchar(max), Id)", upSql);
        Assert.Contains("PRINT CONCAT", upSql);
        Assert.Contains("UserIds", upSql);
        Assert.Contains("no legacy Owner or OwnerAssistant account roles found", upSql);
        Assert.Contains("THROW 51029", downSql);
        Assert.Contains("intentionally irreversible", downSql);
    }
}
