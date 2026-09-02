using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PropertySettingPersistenceTests
{
    [Fact]
    public void PropertySetting_HasApprovedCatalogShape()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(PropertySetting));

        Assert.NotNull(entityType);
        Assert.Equal(150, entityType.FindProperty(nameof(PropertySetting.Name))?.GetMaxLength());
        Assert.False(entityType.FindProperty(nameof(PropertySetting.Name))?.IsNullable);
        Assert.Equal(170, entityType.FindProperty(nameof(PropertySetting.Slug))?.GetMaxLength());
        Assert.False(entityType.FindProperty(nameof(PropertySetting.Slug))?.IsNullable);
        Assert.False(entityType.FindProperty(nameof(PropertySetting.SortOrder))?.IsNullable);
        Assert.Equal(true, entityType.FindProperty(nameof(PropertySetting.IsActive))?.GetDefaultValue());
        Assert.NotNull(entityType.GetQueryFilter());

        var slugIndex = Assert.Single(entityType.GetIndexes(), index =>
            index.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(PropertySetting.Slug)]));
        Assert.True(slugIndex.IsUnique);
    }

    [Fact]
    public void PropertySettingAssignment_HasApprovedIndexesAndDeleteBehavior()
    {
        using var context = CreateMetadataContext();
        var entityType = context.Model.FindEntityType(typeof(PropertySettingAssignment));

        Assert.NotNull(entityType);
        Assert.NotNull(entityType.GetQueryFilter());

        var propertyFirstIndex = Assert.Single(entityType.GetIndexes(), index =>
            index.Properties.Select(property => property.Name).SequenceEqual([
                nameof(PropertySettingAssignment.PropertyId),
                nameof(PropertySettingAssignment.PropertySettingId)
            ]));
        Assert.True(propertyFirstIndex.IsUnique);
        Assert.Null(propertyFirstIndex.GetFilter());

        var settingFirstIndex = Assert.Single(entityType.GetIndexes(), index =>
            index.Properties.Select(property => property.Name).SequenceEqual([
                nameof(PropertySettingAssignment.PropertySettingId),
                nameof(PropertySettingAssignment.PropertyId)
            ]));
        Assert.False(settingFirstIndex.IsUnique);

        var propertyForeignKey = Assert.Single(entityType.GetForeignKeys(), foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(Property));
        Assert.Equal(DeleteBehavior.Cascade, propertyForeignKey.DeleteBehavior);

        var settingForeignKey = Assert.Single(entityType.GetForeignKeys(), foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(PropertySetting));
        Assert.Equal(DeleteBehavior.Restrict, settingForeignKey.DeleteBehavior);
    }

    private static KoochDbContext CreateMetadataContext()
    {
        var options = new DbContextOptionsBuilder<KoochDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new KoochDbContext(options);
    }
}
