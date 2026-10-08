using System.Reflection;
using Kooch.Api.Controllers;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class MealPlanReferenceEndpointTests
{
    [Fact]
    public void GlobalLookup_IsAuthenticatedReadOnlyAndPropertyIndependent()
    {
        var controller = typeof(MealPlansController);
        Assert.Equal("api/meal-plans", controller.GetCustomAttribute<RouteAttribute>()?.Template);
        Assert.NotNull(controller.GetCustomAttribute<AuthorizeAttribute>());
        Assert.Null(controller.GetCustomAttribute<AllowAnonymousAttribute>());

        var action = controller.GetMethod(nameof(MealPlansController.Get))!;
        Assert.NotNull(action.GetCustomAttribute<HttpGetAttribute>());
        Assert.Equal([typeof(CancellationToken)], action.GetParameters().Select(parameter => parameter.ParameterType));
        Assert.Equal(typeof(Task<ActionResult<IReadOnlyList<MealPlanOptionResponse>>>), action.ReturnType);
        Assert.DoesNotContain(controller.GetMethods(BindingFlags.Public | BindingFlags.Instance),
            method => method.GetCustomAttributes<HttpMethodAttribute>()
                .Any(attribute => attribute is not HttpGetAttribute));

        var scoped = typeof(OwnerRoomTypesController).GetMethod(nameof(OwnerRoomTypesController.ListMealPlans))!;
        Assert.Equal("properties/{propertyId:int}/meal-plans", scoped.GetCustomAttribute<HttpGetAttribute>()?.Template);
    }
}
