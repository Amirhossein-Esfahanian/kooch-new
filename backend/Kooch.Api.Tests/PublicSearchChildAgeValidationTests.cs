using System.Text.Json;
using Kooch.Api.Controllers;
using Kooch.Api.Data;
using Kooch.Api.Dtos.Properties;
using Kooch.Api.Entities;
using Kooch.Api.Filters;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.ModelBinding.Binders;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using System.Globalization;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class PublicSearchChildAgeValidationTests
{
    [Theory]
    [InlineData("checkIn", "not-a-date")]
    [InlineData("checkOut", "2026-02-30")]
    public async Task MalformedDate_RemainsAModelBindingValidationError(string field, string value)
    {
        var http = new DefaultHttpContext();
        http.Request.QueryString = QueryString.Create(field, value);
        var action = new ActionContext(http, new RouteData(), new ActionDescriptor());
        var binding = DefaultModelBindingContext.CreateBindingContext(action,
            new QueryStringValueProvider(BindingSource.Query, http.Request.Query, CultureInfo.InvariantCulture),
            new EmptyModelMetadataProvider().GetMetadataForType(typeof(DateOnly?)), null, field);
        await new SimpleTypeModelBinder(typeof(DateOnly?), NullLoggerFactory.Instance).BindModelAsync(binding);
        Assert.False(action.ModelState.IsValid);
        Assert.False(binding.Result.IsModelSet);
        Assert.NotEmpty(action.ModelState[field]!.Errors);
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(PublicPropertiesController), typeof(ApiControllerAttribute)));
    }

    [Theory]
    [InlineData(true, false, 1)]
    [InlineData(false, true, 1)]
    [InlineData(true, true, 0)]
    [InlineData(true, true, -1)]
    public async Task InvalidDatePair_FailsBeforeUndatedProjection_AndUsesExisting400(
        bool hasCheckIn, bool hasCheckOut, int nights)
    {
        // No provider: reaching the search query would fail instead of returning validation.
        using var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>().Options);
        var service = new PropertyService(db, null!, null!, null!, null!, null!);
        var controller = new PublicPropertiesController(service, null!, null!);
        var date = new DateOnly(2026, 10, 12);
        var error = await Assert.ThrowsAsync<ArgumentException>(() => controller.Get(null, null,
            hasCheckIn ? date : null, hasCheckOut ? date.AddDays(nights) : null,
            null, null, null, null, null, CancellationToken.None));
        AssertExisting400(error);
    }

    [Theory]
    [InlineData("?checkIn=")]
    [InlineData("?checkOut=")]
    [InlineData("?checkIn=&checkOut=")]
    [InlineData("?checkIn=%20")]
    public async Task ExplicitEmptyDate_IsRejectedBeforeService(string query)
    {
        var context = new DefaultHttpContext();
        context.Request.QueryString = new QueryString(query);
        var controller = new PublicPropertiesController(null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = context }
        };
        var error = await Assert.ThrowsAsync<ArgumentException>(() => controller.Get(null, null,
            null, null, null, null, null, null, null, CancellationToken.None));
        AssertExisting400(error);
    }

    private static void AssertExisting400(Exception error)
    {
        var context = new ExceptionContext(new ActionContext(new DefaultHttpContext(),
            new RouteData(), new ActionDescriptor()), []) { Exception = error };
        new ApiExceptionFilter().OnException(context);
        var response = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(400, response.StatusCode);
        Assert.Equal("message", Assert.Single(JsonSerializer.SerializeToElement(response.Value).EnumerateObject()).Name);
    }

    public static IEnumerable<object?[]> InvalidRequests()
    {
        (int Children, string? Ages)[] requests =
        [
            (2, "4"), (1, "4,8"), (1, null), (1, ""), (1, "abc"),
            (1, "-1"), (1, "18"), (0, "4"), (2, "4,"), (1, ",4"),
            (2, "4,,8"), (1, "4.5"), (2, "4,abc"), (-1, null)
        ];
        foreach (var dated in new[] { false, true })
            foreach (var request in requests)
                yield return [dated, request.Children, request.Ages];
    }

    [Theory]
    [MemberData(nameof(InvalidRequests))]
    public async Task InvalidSearchParty_IsRejectedByServiceAndReturnsExisting400Response(
        bool dated, int children, string? ages)
    {
        await using var fixture = await Fixture.CreateAsync();
        var error = await Assert.ThrowsAsync<ArgumentException>(() =>
            fixture.SearchAsync(dated, children, ages));
        var endpointError = await Assert.ThrowsAsync<ArgumentException>(() => fixture.Controller.Get(null, null,
            dated ? fixture.CheckIn : null, dated ? fixture.CheckIn.AddDays(2) : null,
            1, 1, children, ages, null, CancellationToken.None));
        var actionContext = new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor());
        var exceptionContext = new ExceptionContext(actionContext, []) { Exception = endpointError };
        new ApiExceptionFilter().OnException(exceptionContext);
        Assert.True(exceptionContext.ExceptionHandled);
        var response = Assert.IsType<ObjectResult>(exceptionContext.Result);
        Assert.Equal(400, response.StatusCode);
        var body = JsonSerializer.SerializeToElement(response.Value);
        Assert.Equal("message", Assert.Single(body.EnumerateObject()).Name);
        Assert.Equal(error.Message, body.GetProperty("message").GetString());
    }

    [Theory]
    [InlineData(false, 0, null)]
    [InlineData(true, 0, null)]
    [InlineData(false, 0, "")]
    [InlineData(true, 0, " ")]
    [InlineData(false, 1, "0")]
    [InlineData(true, 1, "0")]
    [InlineData(false, 1, "17")]
    [InlineData(true, 1, "17")]
    [InlineData(false, 2, "4,10")]
    [InlineData(true, 2, "4,10")]
    public async Task ValidSearchParty_PreservesEligibilityStartingPriceAndEndpointSuccess(
        bool dated, int children, string? ages)
    {
        await using var fixture = await Fixture.CreateAsync();
        var property = Assert.Single(await fixture.SearchAsync(dated, children, ages));
        Assert.Equal(1, property.Id);
        Assert.Equal(100m, property.StartingPrice);
        Assert.Equal(10, Assert.Single(property.MatchingRoomTypes).Id);
        var action = await fixture.Controller.Get(null, null,
            dated ? fixture.CheckIn : null, dated ? fixture.CheckIn.AddDays(2) : null,
            1, 1, children, ages, null, CancellationToken.None);
        Assert.IsType<OkObjectResult>(action.Result);
    }

    [Fact]
    public void ExplicitAgeOrder_IsPreservedWithoutNormalization()
    {
        Assert.Equal([17, 0, 8], PropertyService.ParseChildAges("17, 0,8", 3));
        Assert.Empty(PropertyService.ParseChildAges(null, 0));
    }

    private sealed class Fixture(KoochDbContext db, PropertyService service, DateOnly checkIn) : IAsyncDisposable
    {
        public DateOnly CheckIn { get; } = checkIn;
        public PublicPropertiesController Controller { get; } = new(service, null!, null!);
        public Task<IReadOnlyList<PublicPropertyResponse>> SearchAsync(bool dated, int children, string? ages) =>
            service.GetPublicPropertiesAsync(checkIn: dated ? CheckIn : null,
                checkOut: dated ? CheckIn.AddDays(2) : null, rooms: 1, adults: 1,
                children: children, childAges: ages);

        public static async Task<Fixture> CreateAsync()
        {
            var db = new KoochDbContext(new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString("N")).Options);
            var checkIn = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);
            db.Properties.Add(new Property
            {
                Id = 1, Name = "Property", Slug = "property", Status = PropertyStatus.Approved,
                FreeChildAgeLimit = 5, ChildPrice = 0
            });
            db.RoomTypes.Add(new RoomType
            {
                Id = 10, PropertyId = 1, Name = "Room", Slug = "room", IsActive = true,
                MaxAdults = 4, MaxChildren = 2, TotalInventory = 1, BasePrice = 999,
                InventoryMode = InventoryMode.TypeBasedInventory
            });
            db.RoomDailyPrices.AddRange(Enumerable.Range(0, 2).Select(day => new RoomDailyPrice
            {
                RoomTypeId = 10, Date = checkIn.AddDays(day), BasePrice = 100,
                GuestType = PricingGuestType.Iranian
            }));
            await db.SaveChangesAsync();
            var childRules = new ChildPricingRuleResolver(db);
            var availability = new EffectiveAvailabilityService(db);
            var pricing = new ReservationPricingService(db, new PricingService(), childRules,
                new ReservationRulesResolver(db, childRules));
            var service = new PropertyService(db, null!, null!, null!, null!, childRules,
                new DatedPropertyStartingPriceService(db, availability, childRules, pricing,
                    new PropertySameNightBookingPolicyService(TimeProvider.System)));
            return new(db, service, checkIn);
        }

        public ValueTask DisposeAsync() => db.DisposeAsync();
    }
}
