using System.Security.Claims;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class OwnerGuestContainmentTests
{
    [Theory]
    [InlineData("Search", 10)]
    [InlineData("GetById", 10)]
    [InlineData("Create", 10)]
    [InlineData("Update", 10)]
    [InlineData("Search", 999)]
    [InlineData("GetById", 999)]
    [InlineData("Create", 999)]
    [InlineData("Update", 999)]
    public async Task EveryOwnerGuestAction_ReturnsEmpty403WithoutReadingOrChangingGuests(string action, int propertyId)
    {
        await using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Guests.Add(new Guest { Id = 7, UserId = 2, FirstName = "Private", LastName = "Traveler",
            Email = "private@example.test", NationalCode = "1234567891" });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        // No Guest service, permissions service, database or authenticated actor is needed to deny.
        var controller = new OwnerGuestsController();
        IActionResult? result = action switch
        {
            "Search" => controller.Search(propertyId, new GuestSearchRequest { IncludeDeleted = true }, default).Result,
            "GetById" => controller.GetById(propertyId, 7, default).Result,
            "Create" => controller.Create(propertyId, new GuestCreateRequest { FirstName = "Injected" }, default).Result,
            "Update" => controller.Update(propertyId, 7, new GuestUpdateRequest { FirstName = "Changed" }, default).Result,
            _ => throw new ArgumentOutOfRangeException(nameof(action))
        };
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<StatusCodeResult>(result).StatusCode);
        Assert.Empty(db.ChangeTracker.Entries());
        var saved = Assert.Single(await db.Guests.AsNoTracking().ToListAsync());
        Assert.Equal("Private", saved.FirstName);
        Assert.Equal("private@example.test", saved.Email);
        Assert.Equal(2, saved.UserId);
    }

    [Fact]
    public void ContainmentFilter_DeniesBeforeModelBindingAndIsScopedOnlyToOwnerGuestController()
    {
        var filter = Assert.Single(typeof(OwnerGuestsController)
            .GetCustomAttributes(typeof(OwnerGuestApiDisabledAttribute), true)
            .Cast<OwnerGuestApiDisabledAttribute>());
        var actionContext = new ActionContext(new DefaultHttpContext(), new RouteData(),
            new ActionDescriptor(), new ModelStateDictionary());
        actionContext.ModelState.AddModelError("NationalCode", "Invalid input");
        var context = new ResourceExecutingContext(actionContext, [], []);
        filter.OnResourceExecuting(context);
        Assert.Equal(403, Assert.IsType<StatusCodeResult>(context.Result).StatusCode);
        foreach (var type in new[] { typeof(AdminGuestsController), typeof(OwnerReservationsController),
                     typeof(AccountBookingSessionsController) })
            Assert.Empty(type.GetCustomAttributes(typeof(OwnerGuestApiDisabledAttribute), true));
        Assert.Empty(Assert.Single(typeof(OwnerGuestsController).GetConstructors()).GetParameters());
    }

    [Fact]
    public async Task OwnerReservationListAndDetails_StillWorkAndRetainPropertyScoping()
    {
        await using var harness = await ReservationTestHarness.CreateAsync();
        var reservation = await harness.AddReservationAsync(ReservationStatus.Confirmed);
        var controller = new OwnerReservationsController(harness.Service, new StubPermissionService(true))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([
                        new Claim(ClaimTypes.NameIdentifier, "2"), new Claim(ClaimTypes.Role, "Client")
                    ], "test"))
                }
            }
        };
        var list = Assert.IsType<PagedResult<ReservationListItemResponse>>(
            Assert.IsType<OkObjectResult>((await controller.GetByProperty(10, new(), default)).Result).Value);
        Assert.Equal(reservation.Id, Assert.Single(list.Items).ReservationId);
        var detail = Assert.IsType<ReservationResponse>(
            Assert.IsType<OkObjectResult>((await controller.GetById(10, reservation.Id, default)).Result).Value);
        Assert.Equal(reservation.Id, detail.ReservationId);
        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            controller.GetById(11, reservation.Id, default));
    }
}
