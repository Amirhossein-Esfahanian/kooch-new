using Kooch.Api.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class UserPermissionPropertyIdMigrationTests
{
    [Fact]
    public void Migration_RejectsNonNullPropertyIdsBeforeSchemaChanges()
    {
        var migration = new RemoveLegacyUserPermissionPropertyId();
        var operations = migration.UpOperations;
        var guard = Assert.IsType<SqlOperation>(operations[0]);

        Assert.Contains("STRING_AGG(CONVERT(nvarchar(max), [Id]), N',')", guard.Sql);
        Assert.Contains("WHERE [PropertyId] IS NOT NULL", guard.Sql);
        Assert.Contains("Non-null row IDs:", guard.Sql);
        Assert.Contains("THROW 51030", guard.Sql);
    }

    [Fact]
    public void Migration_ReplacesOnlyLegacyPropertyScopeSchema()
    {
        var migration = new RemoveLegacyUserPermissionPropertyId();
        var operations = migration.UpOperations;

        var foreignKey = Assert.Single(operations.OfType<DropForeignKeyOperation>());
        Assert.Equal("FK_UserPermissions_Properties_PropertyId", foreignKey.Name);

        var droppedIndexes = operations.OfType<DropIndexOperation>()
            .Select(operation => operation.Name)
            .OrderBy(name => name)
            .ToArray();
        Assert.Equal(
            [
                "IX_UserPermissions_PropertyId",
                "IX_UserPermissions_UserId_PermissionKey_PropertyId"
            ],
            droppedIndexes);

        var droppedColumn = Assert.Single(operations.OfType<DropColumnOperation>());
        Assert.Equal("PropertyId", droppedColumn.Name);

        var createdIndex = Assert.Single(operations.OfType<CreateIndexOperation>());
        Assert.Equal("IX_UserPermissions_UserId_PermissionKey", createdIndex.Name);
        Assert.Equal(new[] { "UserId", "PermissionKey" }, createdIndex.Columns);
        Assert.True(createdIndex.IsUnique);
    }
}
