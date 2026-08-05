using System.Reflection;
using Kooch.Api.Catalogs;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Catalogs;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class RoomKindCatalogTests
{
    [Fact]
    public void Catalog_HasExactlyOneCompleteEntryForEveryRoomKind()
    {
        var enumValues = Enum.GetValues<RoomKind>();

        Assert.Equal(enumValues.Length, RoomKindCatalog.Entries.Count);
        Assert.Equal(
            enumValues.Order(),
            RoomKindCatalog.Entries.Select(entry => entry.Value).Order());
        Assert.All(
            RoomKindCatalog.Entries.GroupBy(entry => entry.Value),
            group => Assert.Single(group));
        Assert.All(RoomKindCatalog.Entries, entry =>
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.Code));
            Assert.False(string.IsNullOrWhiteSpace(entry.TitleFa));
            Assert.False(string.IsNullOrWhiteSpace(entry.TitleEn));
        });
    }

    [Fact]
    public void Catalog_CodesAndDisplayOrdersAreUniqueAndStablyOrdered()
    {
        Assert.Equal(
            RoomKindCatalog.Entries.Count,
            RoomKindCatalog.Entries.Select(entry => entry.Code).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(
            RoomKindCatalog.Entries.Count,
            RoomKindCatalog.Entries.Select(entry => entry.DisplayOrder).Distinct().Count());
        Assert.Equal(
            RoomKindCatalog.Entries.OrderBy(entry => entry.DisplayOrder).Select(entry => entry.Value),
            RoomKindCatalog.Entries.Select(entry => entry.Value));
    }

    [Fact]
    public void RoomKind_NumericValuesRemainExplicitAndStable()
    {
        Assert.Equal(1, (int)RoomKind.Single);
        Assert.Equal(2, (int)RoomKind.Double);
        Assert.Equal(3, (int)RoomKind.Twin);
        Assert.Equal(4, (int)RoomKind.Triple);
        Assert.Equal(5, (int)RoomKind.Quad);
        Assert.Equal(6, (int)RoomKind.Family);
        Assert.Equal(7, (int)RoomKind.Suite);
        Assert.Equal(8, (int)RoomKind.JuniorSuite);
        Assert.Equal(9, (int)RoomKind.Apartment);
        Assert.Equal(10, (int)RoomKind.Villa);
        Assert.Equal(11, (int)RoomKind.Dormitory);
        Assert.Equal(12, (int)RoomKind.Other);
    }

    [Fact]
    public void Endpoint_IsAnonymousGetOnlyAndReturnsStableCatalogOrder()
    {
        var controllerType = typeof(CatalogsController);
        Assert.NotNull(controllerType.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("api/catalogs", controllerType.GetCustomAttribute<RouteAttribute>()?.Template);

        var action = controllerType.GetMethod(nameof(CatalogsController.GetRoomKinds));
        Assert.NotNull(action);
        Assert.Equal("room-kinds", action!.GetCustomAttribute<HttpGetAttribute>()?.Template);
        Assert.DoesNotContain(
            controllerType.GetMethods(BindingFlags.Instance | BindingFlags.Public),
            method => method.GetCustomAttributes().Any(attribute =>
                attribute is HttpPostAttribute or HttpPutAttribute or HttpPatchAttribute or HttpDeleteAttribute));

        var result = new CatalogsController().GetRoomKinds();
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsAssignableFrom<IReadOnlyList<RoomKindCatalogResponse>>(ok.Value);

        Assert.Equal(RoomKindCatalog.Entries.Count, response.Count);
        Assert.Equal(
            RoomKindCatalog.Entries.Select(entry => entry.DisplayOrder),
            response.Select(entry => entry.DisplayOrder));
        Assert.Equal(
            RoomKindCatalog.Entries.Select(entry => (int)entry.Value),
            response.Select(entry => entry.Value));
        Assert.Equal(
            RoomKindCatalog.Entries.Select(entry => entry.Code),
            response.Select(entry => entry.Code));
    }
}
