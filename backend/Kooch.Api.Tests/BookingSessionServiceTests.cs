using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kooch.Api.Authentication;
using Kooch.Api.Data;
using Kooch.Api.Dtos.BookingSessions;
using Kooch.Api.Dtos.Reservations;
using Kooch.Api.Entities;
using Kooch.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class BookingSessionServiceTests
{
    [Fact]
    public async Task OneItem_CreatesOneSessionAndOneIndependentReservation()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateRequest(CreateItem(10, 100));
        request.IdempotencyKey = "   ";

        var result = await scope.Service.CreateAsync(request);

        Assert.NotEqual(0, result.BookingSessionId);
        Assert.StartsWith("KCH-S-", result.SessionCode);
        var reservation = Assert.Single(result.Reservations);
        Assert.NotEqual(0, reservation.ReservationId);
        Assert.StartsWith("KCH-", reservation.ReservationNumber);
        Assert.Equal(ReservationStatus.Pending, reservation.Status);

        await using var verification = harness.CreateContext();
        var persisted = await verification.BookingSessions
            .Include(session => session.Reservations)
            .SingleAsync();
        Assert.Null(persisted.IdempotencyKey);
        Assert.Equal(64, persisted.RequestHash?.Length);
        var persistedReservation = Assert.Single(persisted.Reservations);
        Assert.Equal(persisted.Id, persistedReservation.BookingSessionId);
        Assert.Equal(100, persistedReservation.RoomId);
        Assert.Equal(ReservationSource.Website, persistedReservation.Source);
    }

    [Fact]
    public async Task MultipleItems_CreateIndependentUniqueReservationNumbers()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateAsync(
            CreateRequest(
                CreateItem(10, 100),
                CreateItem(20, 200)));

        Assert.Equal(2, result.Reservations.Count);
        Assert.Equal(
            2,
            result.Reservations
                .Select(reservation => reservation.ReservationNumber)
                .Distinct(StringComparer.Ordinal)
                .Count());
        Assert.All(
            result.Reservations,
            reservation => Assert.NotEqual(0, reservation.ReservationId));
    }

    [Fact]
    public async Task OnRequestItem_UsesTheExistingPendingApprovalLifecycle()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Availabilities.Add(new Availability
            {
                RoomTypeId = 10,
                Date = new DateOnly(2035, 2, 1),
                AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        var result = await scope.Service.CreateAsync(CreateRequest(CreateItem(10, 100)));

        Assert.Equal(
            ReservationStatus.PendingApproval,
            Assert.Single(result.Reservations).Status);
        Assert.Equal(
            result.Reservations.Select(reservation => reservation.ReservationId),
            scope.NotificationDispatcher.PendingApprovalReservationIds);
    }

    [Fact]
    public async Task AccountInstantSession_HoldsCapacityAndUsesOneSharedDeadline()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        var before = DateTime.UtcNow.AddMinutes(45);
        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(
                CreateAccountItem(10, 100),
                CreateAccountItem(20, 200)));
        var after = DateTime.UtcNow.AddMinutes(45);

        Assert.All(result.Reservations, reservation =>
            Assert.Equal(ReservationStatus.ApprovedAwaitingPayment, reservation.Status));
        Assert.Empty(scope.NotificationDispatcher.PendingApprovalReservationIds);
        await using var verification = harness.CreateContext();
        var persisted = await verification.Reservations
            .Where(reservation => reservation.BookingSessionId == result.BookingSessionId)
            .OrderBy(reservation => reservation.Id)
            .ToListAsync();
        var deadline = Assert.Single(
            persisted.Select(reservation => reservation.PaymentExpiresAtUtc).Distinct());
        Assert.NotNull(deadline);
        Assert.InRange(deadline.Value, before, after);
        Assert.All(persisted, reservation => Assert.NotNull(reservation.ApprovedAtUtc));
        Assert.All(persisted, reservation => Assert.Null(reservation.ApprovalExpiresAtUtc));

        var availability = await new EffectiveAvailabilityService(verification).GetRangeAsync(
            [10],
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3));
        Assert.All(availability[10].Nights.Values, night =>
            Assert.Equal(1, night.RemainingCapacity));
    }

    [Fact]
    public async Task AccountOnRequestSession_StartsPendingWithoutPaymentDeadline()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Availabilities.Add(new Availability
            {
                RoomTypeId = 10,
                Date = new DateOnly(2035, 2, 1),
                AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        var approvalDeadlineBefore = DateTime.UtcNow.AddMinutes(45);
        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(CreateAccountItem(10, 100)));
        var approvalDeadlineAfter = DateTime.UtcNow.AddMinutes(45);

        Assert.Equal(
            ReservationStatus.PendingApproval,
            Assert.Single(result.Reservations).Status);
        await using var verification = harness.CreateContext();
        var persisted = await verification.Reservations.SingleAsync();
        Assert.Null(persisted.PaymentExpiresAtUtc);
        Assert.NotNull(persisted.ApprovalExpiresAtUtc);
        Assert.InRange(
            persisted.ApprovalExpiresAtUtc.Value,
            approvalDeadlineBefore,
            approvalDeadlineAfter);
        var originalApprovalDeadline = persisted.ApprovalExpiresAtUtc;
        var setting = await verification.SiteSettings.SingleAsync(item =>
            item.Key == "reservation.ownerApprovalWindowMinutes");
        setting.Value = "90";
        await verification.SaveChangesAsync();
        verification.ChangeTracker.Clear();
        Assert.Equal(
            originalApprovalDeadline,
            (await verification.Reservations.SingleAsync()).ApprovalExpiresAtUtc);
        var availability = await new EffectiveAvailabilityService(verification).GetRangeAsync(
            [10],
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3));
        Assert.All(availability[10].Nights.Values, night =>
            Assert.Equal(2, night.RemainingCapacity));
    }

    [Fact]
    public async Task AccountQuantityWithinCapacity_CreatesIndependentReservationsWithoutRoomAssignments()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(
                CreateAccountItem(10, roomId: null),
                CreateAccountItem(10, roomId: null)));

        Assert.Equal(2, result.Reservations.Count);
        Assert.All(result.Reservations, reservation => Assert.Null(reservation.RoomId));
        Assert.Equal(
            2,
            result.Reservations.Select(reservation => reservation.ReservationNumber).Distinct().Count());

        await using var verification = harness.CreateContext();
        var availability = await new EffectiveAvailabilityService(verification).GetRangeAsync(
            [10],
            new DateOnly(2035, 2, 1),
            new DateOnly(2035, 2, 3));
        Assert.All(availability[10].Nights.Values, night => Assert.Equal(0, night.RemainingCapacity));
    }

    [Fact]
    public async Task AccountQuantityBeyondCapacity_IsRejectedWithoutPartialPersistence()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateAccountRequest(
                    CreateAccountItem(10, roomId: null),
                    CreateAccountItem(10, roomId: null),
                    CreateAccountItem(10, roomId: null))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task AccountSession_RejectsMixedModesAndDifferentProperties()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Availabilities.Add(new Availability
            {
                RoomTypeId = 10,
                Date = new DateOnly(2035, 2, 1),
                AvailableCount = 2,
                Status = AvailabilityStatus.OnRequest
            });
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateAccountRequest(
                    CreateAccountItem(10, 100),
                    CreateAccountItem(20, 200))));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateAccountRequest(
                    CreateAccountItem(10, 100),
                    CreateAccountItem(30, 300))));
    }

    [Fact]
    public async Task AccountSession_PreservesIdempotentReplay()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));

        var first = await scope.Service.CreateForAccountAsync(1, request);
        var replay = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(first.BookingSessionId, replay.BookingSessionId);
        Assert.Equal(
            Assert.Single(first.Reservations).ReservationId,
            Assert.Single(replay.Reservations).ReservationId);
    }

    [Fact]
    public async Task AccountBookingForSelf_DefaultPayloadPreservesLegacyRequestHash()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var accountItem = CreateAccountItem(10, 100);
        var accountRequest = CreateAccountRequest(accountItem);
        var internalRequest = new BookingSessionCreateRequest
        {
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            IdempotencyKey = accountRequest.IdempotencyKey,
            Items =
            [
                new BookingSessionReservationCreateItem
                {
                    RoomTypeId = accountItem.RoomTypeId,
                    RoomId = accountItem.RoomId,
                    CheckInDate = accountItem.CheckInDate,
                    CheckOutDate = accountItem.CheckOutDate,
                    Adults = accountItem.Adults,
                    Children = accountItem.Children,
                    ChildAges = accountItem.ChildAges,
                    GuestType = PricingGuestType.Iranian
                }
            ]
        };
        var canonicalHash = BookingSessionService.ComputeRequestHash(internalRequest);
        var expectedLegacyHash = Convert.ToHexString(SHA256.HashData(
            Encoding.UTF8.GetBytes("Account" + canonicalHash)));

        await scope.Service.CreateForAccountAsync(1, accountRequest);

        await using var verification = harness.CreateContext();
        Assert.Equal(expectedLegacyHash, (await verification.BookingSessions.SingleAsync()).RequestHash);
    }

    [Fact]
    public async Task AccountBookingForAnother_WithoutNationalCodePreservesLegacyRequestHash()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var accountItem = CreateAccountItem(10, 100);
        var request = CreateOtherGuestAccountRequest(accountItem);
        var internalRequest = new BookingSessionCreateRequest
        {
            ClientId = 1,
            PropertyId = 1,
            IdempotencyKey = request.IdempotencyKey,
            Items =
            [
                new BookingSessionReservationCreateItem
                {
                    RoomTypeId = accountItem.RoomTypeId,
                    RoomId = accountItem.RoomId,
                    CheckInDate = accountItem.CheckInDate,
                    CheckOutDate = accountItem.CheckOutDate,
                    Adults = accountItem.Adults,
                    Children = accountItem.Children,
                    ChildAges = accountItem.ChildAges,
                    GuestType = PricingGuestType.Iranian
                }
            ]
        };
        var canonicalHash = BookingSessionService.ComputeRequestHash(internalRequest);
        var legacyPayload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            BookingHash = canonicalHash,
            BookingForSelf = false,
            ExpectedArrivalTime = (string?)null,
            SpecialRequest = (string?)null,
            PrimaryGuest = new
            {
                FirstName = "Niloofar",
                LastName = "Traveler",
                Mobile = "09123456789",
                Email = (string?)null
            }
        });
        var expectedLegacyHash = Convert.ToHexString(SHA256.HashData(legacyPayload));

        await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        Assert.Equal(expectedLegacyHash, (await verification.BookingSessions.SingleAsync()).RequestHash);
    }

    [Fact]
    public async Task AccountBookingForSelf_ReusesTheLinkedGuest()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(CreateAccountItem(10, 100)));

        Assert.Equal(1, result.GuestId);
        await using var verification = harness.CreateContext();
        Assert.Single(await verification.Guests.ToListAsync());
        Assert.All(
            await verification.Reservations.ToListAsync(),
            reservation => Assert.Equal(1, reservation.GuestId));
    }

    [Fact]
    public async Task AccountBookingForSelf_WithNationalCode_UpdatesAndReusesLinkedGuest()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
        {
            NationalCode = "  ۰۰۱۲۳۴۵۶۷۸  "
        };

        var result = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(1, result.GuestId);
        await using var verification = harness.CreateContext();
        var linkedGuest = await verification.Guests.SingleAsync();
        Assert.Equal(1, linkedGuest.UserId);
        Assert.Equal("0012345678", linkedGuest.NationalCode);
        Assert.Equal(1, await verification.Users.CountAsync());
    }

    [Theory]
    [InlineData("FirstName", "  Updated  ", "Updated")]
    [InlineData("LastName", "  Traveler  ", "Traveler")]
    [InlineData("Mobile", "+98 912 345 6789", "09123456789")]
    [InlineData("Email", "  GUEST@EXAMPLE.TEST ", "guest@example.test")]
    [InlineData("NationalCode", "  ۱۲۳۴۵۶۷۸۹۰  ", "1234567890")]
    public async Task AccountBookingForSelf_UpdatesOnlyTheSuppliedLinkedGuestField(
        string field,
        string value,
        string expected)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest();
        typeof(AccountBookingSessionPrimaryGuestRequest).GetProperty(field)!.SetValue(
            request.PrimaryGuest,
            value);

        var result = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(1, result.GuestId);
        await using var verification = harness.CreateContext();
        var guest = await verification.Guests.SingleAsync();
        var persisted = field switch
        {
            "FirstName" => guest.FirstName,
            "LastName" => guest.LastName,
            "Mobile" => guest.Mobile,
            "Email" => guest.Email,
            _ => guest.NationalCode
        };
        Assert.Equal(expected, persisted);
        var user = await verification.Users.SingleAsync();
        Assert.Equal("Booking", user.FirstName);
        Assert.Equal("Client", user.LastName);
        Assert.Null(user.PhoneNumber);
        Assert.Null(user.Email);
    }

    [Fact]
    public async Task AccountBookingForSelf_UpdatesAllGuestFieldsWithoutChangingUserOrGuestAssignment()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(
            CreateAccountItem(10, 100),
            CreateAccountItem(20, 200));
        request.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
        {
            FirstName = "  Niloofar ",
            LastName = " Traveler ",
            Mobile = "+98 912 345 6789",
            Email = " Niloofar@Example.Test ",
            NationalCode = " ۱۲۳۴۵۶۷۸۹۰ "
        };

        var result = await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var guest = await verification.Guests.SingleAsync();
        Assert.Equal(1, guest.Id);
        Assert.Equal(1, guest.UserId);
        Assert.Equal("Niloofar", guest.FirstName);
        Assert.Equal("Traveler", guest.LastName);
        Assert.Equal("09123456789", guest.NormalizedMobile);
        Assert.Equal("niloofar@example.test", guest.NormalizedEmail);
        Assert.Equal("1234567890", guest.NationalCode);
        Assert.Single(await verification.Guests.ToListAsync());
        Assert.All(await verification.Reservations.ToListAsync(), reservation =>
            Assert.Equal(guest.Id, reservation.GuestId));
        var user = await verification.Users.SingleAsync();
        Assert.Equal("Booking", user.FirstName);
        Assert.Equal("Client", user.LastName);
        Assert.Null(user.PhoneNumber);
        Assert.Null(user.Email);
        var currentUser = await new AuthService(
                verification,
                Options.Create(new JwtOptions()),
                new PropertyAccessService(verification),
                null!,
                null!)
            .GetCurrentUserAsync(1);
        Assert.NotNull(currentUser?.LinkedGuest);
        Assert.Equal("Niloofar", currentUser.LinkedGuest.FirstName);
        Assert.Equal("1234567890", currentUser.LinkedGuest.NationalCode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AccountBookingForSelf_RejectsConflictingNormalizedContact(bool mobileConflict)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Guests.Add(new Guest
            {
                Id = 2,
                FirstName = "Other",
                LastName = "Guest",
                Mobile = mobileConflict ? "09123456789" : null,
                NormalizedMobile = mobileConflict ? "09123456789" : null,
                Email = mobileConflict ? null : "other@example.test",
                NormalizedEmail = mobileConflict ? null : "other@example.test"
            });
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
        {
            Mobile = mobileConflict ? "+98 912 345 6789" : null,
            Email = mobileConflict ? null : " OTHER@EXAMPLE.TEST "
        };

        await Assert.ThrowsAsync<ArgumentException>(() =>
            scope.Service.CreateForAccountAsync(1, request));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Equal(2, await verification.Guests.CountAsync());
    }

    [Fact]
    public async Task AccountBookingForSelf_WithoutLinkedGuestCreatesExactlyOneFromAuthenticatedUser()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Guests.Remove(await setup.Guests.SingleAsync());
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateAccountRequest(CreateAccountItem(10, 100)));

        await using var verification = harness.CreateContext();
        var guest = await verification.Guests.SingleAsync();
        Assert.Equal(1, guest.UserId);
        Assert.Equal("Booking", guest.FirstName);
        Assert.Equal("Client", guest.LastName);
        Assert.Equal(guest.Id, result.GuestId);
        Assert.Equal(guest.Id, (await verification.BookingSessions.SingleAsync()).GuestId);
        Assert.Equal(guest.Id, (await verification.Reservations.SingleAsync()).GuestId);
    }

    [Fact]
    public async Task AccountBookingForSelf_GuestFieldsParticipateInIdempotency()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateAccountRequest(CreateAccountItem(10, 100));
        original.IdempotencyKey = "self-guest-fields";
        original.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
        {
            FirstName = "  Niloofar ",
            Mobile = "+98 912 345 6789"
        };
        var replay = CreateAccountRequest(CreateAccountItem(10, 100));
        replay.IdempotencyKey = "self-guest-fields";
        replay.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
        {
            FirstName = "Niloofar",
            Mobile = "09123456789"
        };

        var first = await scope.Service.CreateForAccountAsync(1, original);
        var second = await scope.Service.CreateForAccountAsync(1, replay);
        Assert.Equal(first.BookingSessionId, second.BookingSessionId);

        replay.PrimaryGuest.LastName = "Changed";
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(1, replay));
    }

    [Fact]
    public async Task AccountBookingForAnother_CreatesIndependentGuestForEveryChild()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(
            CreateAccountItem(10, 100),
            CreateAccountItem(20, 200));

        var result = await scope.Service.CreateForAccountAsync(1, request);

        Assert.NotNull(result.GuestId);
        Assert.NotEqual(1, result.GuestId);
        await using var verification = harness.CreateContext();
        var session = await verification.BookingSessions
            .Include(item => item.Reservations)
            .SingleAsync();
        Assert.Equal(1, session.ClientId);
        Assert.Equal(result.GuestId, session.GuestId);
        Assert.All(session.Reservations, reservation => Assert.Equal(session.GuestId, reservation.GuestId));
        var traveler = await verification.Guests.SingleAsync(guest => guest.Id == session.GuestId);
        Assert.Null(traveler.UserId);
        Assert.Equal(1, await verification.Users.CountAsync());
    }

    [Fact]
    public async Task AccountBookingForAnother_WithNationalCode_PersistsNormalizedValueWithoutCreatingUser()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.NationalCode = "  ۱۲۳۴۵۶۷۸۹۰  ";

        var result = await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var traveler = await verification.Guests.SingleAsync(guest => guest.Id == result.GuestId);
        Assert.Equal("1234567890", traveler.NationalCode);
        Assert.Equal(1, await verification.Users.CountAsync());
    }

    [Fact]
    public async Task AccountBookingForAnother_WhitespaceNationalCode_PersistsNull()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.NationalCode = "   ";

        var result = await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        Assert.Null((await verification.Guests.SingleAsync(guest => guest.Id == result.GuestId)).NationalCode);
    }

    [Fact]
    public async Task AccountBookingForAnother_NationalCodeOverTwentyCharacters_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.NationalCode = new string('1', 21);

        await Assert.ThrowsAsync<ArgumentException>(() =>
            scope.Service.CreateForAccountAsync(1, request));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task AccountBookingForAnother_NationalCodeIsNotAResolveKey()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Guests.Add(new Guest
            {
                Id = 2,
                FirstName = "Existing",
                LastName = "Traveler",
                Mobile = "09121111111",
                NormalizedMobile = "09121111111",
                NationalCode = "1234567890"
            });
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.NationalCode = "1234567890";

        var result = await scope.Service.CreateForAccountAsync(1, request);

        Assert.NotEqual(2, result.GuestId);
        await using var verification = harness.CreateContext();
        Assert.Equal(3, await verification.Guests.CountAsync());
    }

    [Theory]
    [InlineData(null, "Traveler", "0912 345 6789", null, "نام مهمان")]
    [InlineData("Niloofar", null, "0912 345 6789", null, "نام خانوادگی")]
    [InlineData("Niloofar", "Traveler", null, null, "شماره موبایل یا ایمیل")]
    public async Task AccountBookingForAnother_RejectsMissingRequiredGuestData(
        string? firstName,
        string? lastName,
        string? mobile,
        string? email,
        string expectedMessage)
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
        {
            FirstName = firstName,
            LastName = lastName,
            Mobile = mobile,
            Email = email
        };

        var exception = await Assert.ThrowsAsync<ArgumentException>(
            () => scope.Service.CreateForAccountAsync(1, request));

        Assert.Contains(expectedMessage, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AccountBookingForAnother_AcceptsMobileOnlyAndNormalizesIt()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.Mobile = "+98 912 345 6789";
        request.PrimaryGuest.Email = null;

        var result = await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var traveler = await verification.Guests.SingleAsync(guest => guest.Id == result.GuestId);
        Assert.Equal("09123456789", traveler.Mobile);
        Assert.Equal("09123456789", traveler.NormalizedMobile);
        Assert.Null(traveler.Email);
    }

    [Fact]
    public async Task AccountBookingForAnother_AcceptsEmailOnlyAndNormalizesIt()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.Mobile = null;
        request.PrimaryGuest.Email = "  TRAVELER@EXAMPLE.TEST ";

        var result = await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var traveler = await verification.Guests.SingleAsync(guest => guest.Id == result.GuestId);
        Assert.Equal("traveler@example.test", traveler.Email);
        Assert.Equal("traveler@example.test", traveler.NormalizedEmail);
    }

    [Fact]
    public async Task AccountBookingForAnother_ResolvesOneExactExistingGuest()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Guests.Add(new Guest
            {
                Id = 2,
                FirstName = "Niloofar",
                LastName = "Traveler",
                Mobile = "09123456789",
                NormalizedMobile = "09123456789"
            });
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService();

        var result = await scope.Service.CreateForAccountAsync(
            1,
            CreateOtherGuestAccountRequest(CreateAccountItem(10, 100)));

        Assert.Equal(2, result.GuestId);
        await using var verification = harness.CreateContext();
        Assert.Equal(2, await verification.Guests.CountAsync());
    }

    [Fact]
    public async Task AccountBookingForAnother_NationalCodeFillsMatchedGuestWithoutChangingResolveKey()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Guests.Add(new Guest
            {
                Id = 2,
                FirstName = "Niloofar",
                LastName = "Traveler",
                Mobile = "09123456789",
                NormalizedMobile = "09123456789"
            });
            await setup.SaveChangesAsync();
        }
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.PrimaryGuest!.NationalCode = "1234567890";

        var result = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(2, result.GuestId);
        await using var verification = harness.CreateContext();
        Assert.Equal(2, await verification.Guests.CountAsync());
        Assert.Equal("1234567890", (await verification.Guests.FindAsync(2))!.NationalCode);
    }

    [Fact]
    public async Task AccountStayDetails_PersistArrivalAndSharedSpecialRequest()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(
            CreateAccountItem(10, 100),
            CreateAccountItem(20, 200));
        request.ExpectedArrivalTime = new TimeOnly(18, 30);
        request.SpecialRequest = "  اتاق آرام باشد  ";
        request.Items[0].Notes = "یادداشت قدیمی";

        await scope.Service.CreateForAccountAsync(1, request);

        await using var verification = harness.CreateContext();
        var session = await verification.BookingSessions.Include(item => item.Reservations).SingleAsync();
        Assert.Equal(new TimeOnly(18, 30), session.ExpectedArrivalTime);
        Assert.All(session.Reservations, reservation => Assert.Equal("اتاق آرام باشد", reservation.GuestNote));
    }

    [Fact]
    public async Task AccountStayDetails_NullArrivalAndLegacyItemNotesRemainSupported()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var item = CreateAccountItem(10, 100);
        item.Notes = "  یادداشت آیتم  ";

        await scope.Service.CreateForAccountAsync(1, CreateAccountRequest(item));

        await using var verification = harness.CreateContext();
        Assert.Null((await verification.BookingSessions.SingleAsync()).ExpectedArrivalTime);
        Assert.Equal("یادداشت آیتم", (await verification.Reservations.SingleAsync()).GuestNote);
    }

    [Fact]
    public async Task AccountStayDetails_RejectsOversizedSpecialRequest()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateAccountRequest(CreateAccountItem(10, 100));
        request.SpecialRequest = new string('x', 2001);

        await Assert.ThrowsAsync<ArgumentException>(
            () => scope.Service.CreateForAccountAsync(1, request));
    }

    [Fact]
    public async Task AccountOtherGuest_PricingFailureLeavesNoOrphanGuest()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var pricing = new TestReservationPricingService { ThrowOnPublicCall = 2 };
        await using var scope = harness.CreateService(pricing);

        await Assert.ThrowsAsync<IncompleteDailyPricingException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateOtherGuestAccountRequest(
                    CreateAccountItem(10, 100),
                    CreateAccountItem(20, 200))));

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.Guests.ToListAsync());
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task AccountStayDetails_ArePartOfIdempotencySemantics()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var request = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        request.IdempotencyKey = "stay-details-1";
        request.ExpectedArrivalTime = new TimeOnly(17, 0);
        request.SpecialRequest = "بالش اضافه";

        var first = await scope.Service.CreateForAccountAsync(1, request);
        var replay = await scope.Service.CreateForAccountAsync(1, request);

        Assert.Equal(first.BookingSessionId, replay.BookingSessionId);
        await using var verification = harness.CreateContext();
        Assert.Equal(2, await verification.Guests.CountAsync());

        request.ExpectedArrivalTime = new TimeOnly(18, 0);
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateForAccountAsync(1, request));
    }

    [Fact]
    public async Task AccountOtherGuest_NormalizedPayloadReplaysIdempotently()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        original.IdempotencyKey = "normalized-stay-details";
        original.PrimaryGuest!.FirstName = "  Niloofar ";
        original.PrimaryGuest.Mobile = "+98 912 345 6789";
        original.SpecialRequest = "  بالش اضافه ";

        var first = await scope.Service.CreateForAccountAsync(1, original);
        var replay = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        replay.IdempotencyKey = "normalized-stay-details";
        replay.PrimaryGuest!.FirstName = "Niloofar";
        replay.PrimaryGuest.Mobile = "09123456789";
        replay.SpecialRequest = "بالش اضافه";

        var replayResult = await scope.Service.CreateForAccountAsync(1, replay);

        Assert.Equal(first.BookingSessionId, replayResult.BookingSessionId);
    }

    [Fact]
    public async Task AccountOtherGuest_NormalizedNationalCodeReplaysIdempotently()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        original.IdempotencyKey = "normalized-national-code";
        original.PrimaryGuest!.NationalCode = "  ۱۲۳۴۵۶۷۸۹۰  ";

        var first = await scope.Service.CreateForAccountAsync(1, original);
        var replay = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        replay.IdempotencyKey = "normalized-national-code";
        replay.PrimaryGuest!.NationalCode = "1234567890";

        var replayResult = await scope.Service.CreateForAccountAsync(1, replay);

        Assert.Equal(first.BookingSessionId, replayResult.BookingSessionId);
    }

    [Fact]
    public async Task AccountOtherGuest_ChangedNationalCodeConflictsWithExistingKey()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        original.IdempotencyKey = "changed-national-code";
        original.PrimaryGuest!.NationalCode = "1234567890";
        await scope.Service.CreateForAccountAsync(1, original);

        var changed = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        changed.IdempotencyKey = "changed-national-code";
        changed.PrimaryGuest!.NationalCode = "1234567891";

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            scope.Service.CreateForAccountAsync(1, changed));
    }

    [Fact]
    public async Task AccountOtherGuest_ChangedGuestOrSpecialRequestConflictsWithExistingKey()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        original.IdempotencyKey = "changed-stay-details";
        original.SpecialRequest = "بالش اضافه";
        await scope.Service.CreateForAccountAsync(1, original);

        var changedGuest = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        changedGuest.IdempotencyKey = "changed-stay-details";
        changedGuest.SpecialRequest = "بالش اضافه";
        changedGuest.PrimaryGuest!.LastName = "Different";
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateForAccountAsync(1, changedGuest));

        var changedRequest = CreateOtherGuestAccountRequest(CreateAccountItem(10, 100));
        changedRequest.IdempotencyKey = "changed-stay-details";
        changedRequest.SpecialRequest = "اتاق آرام";
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateForAccountAsync(1, changedRequest));
    }

    [Fact]
    public async Task FailurePreparingSecondItem_RollsBackTheCompleteSession()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var pricing = new TestReservationPricingService { ThrowOnCall = 2 };
        await using var scope = harness.CreateService(pricing);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(
                CreateRequest(
                    CreateItem(10, 100),
                    CreateItem(20, 200))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task AccountDailyPricingFailureOnSecondItem_RollsBackTheCompleteSession()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var pricing = new TestReservationPricingService { ThrowOnPublicCall = 2 };
        await using var scope = harness.CreateService(pricing);

        await Assert.ThrowsAsync<IncompleteDailyPricingException>(() =>
            scope.Service.CreateForAccountAsync(
                1,
                CreateAccountRequest(
                    CreateAccountItem(10, 100),
                    CreateAccountItem(20, 200))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
        Assert.Empty(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task RoomTypeFromAnotherProperty_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<ArgumentException>(
            () => scope.Service.CreateAsync(CreateRequest(CreateItem(30, 300))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task DifferentCurrencies_AreRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        var pricing = new TestReservationPricingService
        {
            CurrencyForRoomType = roomTypeId => roomTypeId == 10 ? "IRR" : "USD"
        };
        await using var scope = harness.CreateService(pricing);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(
                CreateRequest(
                    CreateItem(10, 100),
                    CreateItem(20, 200))));

        await using var verification = harness.CreateContext();
        Assert.Empty(await verification.BookingSessions.ToListAsync());
    }

    [Fact]
    public async Task DuplicateNamedRoom_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(
                CreateRequest(
                    CreateItem(10, 100),
                    CreateItem(10, 100))));
    }

    [Fact]
    public async Task InsufficientCapacity_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using (var setup = harness.CreateContext())
        {
            setup.Reservations.Add(CreateConsumingReservation(40));
            await setup.SaveChangesAsync();
        }

        await using var scope = harness.CreateService();
        var item = CreateItem(40, roomId: null);
        item.Status = ReservationStatus.Confirmed;

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(CreateRequest(item)));
    }

    [Fact]
    public async Task ConcurrentRequests_CannotBothTakeTheLastCapacity()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var firstScope = harness.CreateService();
        await using var secondScope = harness.CreateService();
        var firstItem = CreateItem(40, roomId: null);
        firstItem.Status = ReservationStatus.Confirmed;
        var secondItem = CreateItem(40, roomId: null);
        secondItem.Status = ReservationStatus.Confirmed;

        var attempts = await Task.WhenAll(
            TryCreateAsync(firstScope.Service, CreateRequest(firstItem)),
            TryCreateAsync(secondScope.Service, CreateRequest(secondItem)));

        Assert.Single(attempts, attempt => attempt.Result is not null);
        Assert.Single(attempts, attempt => attempt.Error is InvalidOperationException);

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Single(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public void LockOrder_IsDeterministicAndAscending()
    {
        var items = new[]
        {
            CreateItem(20, 300),
            CreateItem(10, 200),
            CreateItem(20, 100),
            CreateItem(10, roomId: null)
        };

        var order = BookingSessionService.BuildLockOrder(items);

        Assert.Equal([10, 20], order.RoomTypeIds);
        Assert.Equal([100, 200, 300], order.RoomIds);
    }

    [Fact]
    public async Task SameClientKeyAndCanonicalPayload_ReturnsTheExistingSession()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var firstRequest = CreateRequest(
            CreateItem(20, 200, notes: " second "),
            CreateItem(10, 100, notes: "first"));
        firstRequest.IdempotencyKey = "  checkout-42  ";

        var first = await scope.Service.CreateAsync(firstRequest);

        var replayRequest = CreateRequest(
            CreateItem(10, 100, notes: " first "),
            CreateItem(20, 200, notes: "second"));
        replayRequest.IdempotencyKey = "checkout-42";
        var replay = await scope.Service.CreateAsync(replayRequest);

        Assert.Equal(first.BookingSessionId, replay.BookingSessionId);
        Assert.Equal(first.SessionCode, replay.SessionCode);
        Assert.Equal(
            first.Reservations.Select(item => item.ReservationNumber).Order().ToArray(),
            replay.Reservations.Select(item => item.ReservationNumber).Order().ToArray());

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Equal(2, await verification.Reservations.CountAsync());
        var persisted = await verification.BookingSessions.SingleAsync();
        Assert.Equal("checkout-42", persisted.IdempotencyKey);
        Assert.Equal(64, persisted.RequestHash?.Length);
    }

    [Fact]
    public async Task SameClientKeyWithDifferentPayload_IsRejected()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        await using var scope = harness.CreateService();
        var original = CreateRequest(CreateItem(10, 100, notes: "original"));
        original.IdempotencyKey = "checkout-43";
        await scope.Service.CreateAsync(original);

        var changed = CreateRequest(CreateItem(10, 100, notes: "changed"));
        changed.IdempotencyKey = " checkout-43 ";

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => scope.Service.CreateAsync(changed));
        Assert.Contains("different booking payload", exception.Message, StringComparison.Ordinal);

        await using var verification = harness.CreateContext();
        Assert.Single(await verification.BookingSessions.ToListAsync());
        Assert.Single(await verification.Reservations.ToListAsync());
    }

    [Fact]
    public async Task ExistingStandaloneReservation_RemainsSessionlessAndValid()
    {
        await using var harness = await BookingSessionTestHarness.CreateAsync();
        int standaloneId;
        await using (var setup = harness.CreateContext())
        {
            var standalone = new Reservation
            {
                ReservationNumber = "KCH-LEGACY-STANDALONE",
                ClientId = 1,
                GuestId = 1,
                PropertyId = 1,
                RoomTypeId = 10,
                RoomId = 100,
                CheckInDate = new DateOnly(2035, 1, 1),
                CheckOutDate = new DateOnly(2035, 1, 2),
                AdultCount = 1,
                Currency = "IRR",
                Status = ReservationStatus.Pending
            };
            setup.Reservations.Add(standalone);
            await setup.SaveChangesAsync();
            standaloneId = standalone.Id;
        }

        await using var scope = harness.CreateService();
        await scope.Service.CreateAsync(CreateRequest(CreateItem(20, 200)));

        await using var verification = harness.CreateContext();
        var persistedStandalone = await verification.Reservations.SingleAsync(
            reservation => reservation.Id == standaloneId);
        Assert.Null(persistedStandalone.BookingSessionId);
        Assert.Equal("KCH-LEGACY-STANDALONE", persistedStandalone.ReservationNumber);
    }

    private static async Task<CreateAttempt> TryCreateAsync(
        IBookingSessionService service,
        BookingSessionCreateRequest request)
    {
        try
        {
            return new CreateAttempt(await service.CreateAsync(request), null);
        }
        catch (Exception exception)
        {
            return new CreateAttempt(null, exception);
        }
    }

    private static BookingSessionCreateRequest CreateRequest(
        params BookingSessionReservationCreateItem[] items) =>
        new()
        {
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            Items = items
        };

    private static BookingSessionReservationCreateItem CreateItem(
        int roomTypeId,
        int? roomId,
        string? notes = null) =>
        new()
        {
            RoomTypeId = roomTypeId,
            RoomId = roomId,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            Adults = 1,
            Notes = notes
        };

    private static AccountBookingSessionCreateRequest CreateAccountRequest(
        params AccountBookingSessionReservationCreateItem[] items) =>
        new()
        {
            IdempotencyKey = Guid.NewGuid().ToString("N"),
            Items = items
        };

    private static AccountBookingSessionCreateRequest CreateOtherGuestAccountRequest(
        params AccountBookingSessionReservationCreateItem[] items) =>
        new()
        {
            IdempotencyKey = Guid.NewGuid().ToString("N"),
            BookingForSelf = false,
            PrimaryGuest = new AccountBookingSessionPrimaryGuestRequest
            {
                FirstName = "Niloofar",
                LastName = "Traveler",
                Mobile = "09123456789"
            },
            Items = items
        };

    private static AccountBookingSessionReservationCreateItem CreateAccountItem(
        int roomTypeId,
        int? roomId) =>
        new()
        {
            RoomTypeId = roomTypeId,
            RoomId = roomId,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            Adults = 1
        };

    private static Reservation CreateConsumingReservation(int roomTypeId) =>
        new()
        {
            ReservationNumber = $"KCH-EXISTING-{Guid.NewGuid():N}",
            ClientId = 1,
            GuestId = 1,
            PropertyId = 1,
            RoomTypeId = roomTypeId,
            CheckInDate = new DateOnly(2035, 2, 1),
            CheckOutDate = new DateOnly(2035, 2, 3),
            AdultCount = 1,
            Currency = "IRR",
            Status = ReservationStatus.Confirmed
        };

    private sealed record CreateAttempt(
        BookingSessionCreateResult? Result,
        Exception? Error);

    private sealed class BookingSessionTestHarness : IAsyncDisposable
    {
        private readonly DbContextOptions<KoochDbContext> options;

        private BookingSessionTestHarness(DbContextOptions<KoochDbContext> options)
        {
            this.options = options;
        }

        public static async Task<BookingSessionTestHarness> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<KoochDbContext>()
                .UseInMemoryDatabase($"booking-session-service-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings =>
                    warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var harness = new BookingSessionTestHarness(options);
            await using var context = harness.CreateContext();
            context.Users.Add(new User
            {
                Id = 1,
                FirstName = "Booking",
                LastName = "Client",
                PasswordHash = "hash",
                Role = UserRole.Client,
                IsActive = true
            });
            context.Guests.Add(new Guest
            {
                Id = 1,
                UserId = 1,
                FirstName = "Booking",
                LastName = "Guest"
            });
            context.SiteSettings.Add(new SiteSetting
            {
                Id = 1,
                Key = "reservation.paymentWindowMinutes",
                Value = "45",
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = "Payment window",
                IsActive = true
            });
            context.SiteSettings.Add(new SiteSetting
            {
                Id = 2,
                Key = "reservation.ownerApprovalWindowMinutes",
                Value = "45",
                Type = SiteSettingType.Number,
                Group = "Reservation",
                Label = "Owner approval window",
                IsActive = true
            });
            context.Properties.AddRange(
                new Property
                {
                    Id = 1,
                    OwnerId = 1,
                    DestinationId = 1,
                    Name = "Property One",
                    Slug = "property-one",
                    Description = "Test property",
                    Address = "Address",
                    City = "City",
                    Country = "IR",
                    Status = PropertyStatus.Approved
                },
                new Property
                {
                    Id = 2,
                    OwnerId = 1,
                    DestinationId = 1,
                    Name = "Property Two",
                    Slug = "property-two",
                    Description = "Test property",
                    Address = "Address",
                    City = "City",
                    Country = "IR",
                    Status = PropertyStatus.Approved
                });
            context.RoomTypes.AddRange(
                CreateRoomType(10, 1, 2),
                CreateRoomType(20, 1, 2),
                CreateRoomType(30, 2, 2),
                CreateRoomType(40, 1, 1, InventoryMode.TypeBasedInventory));
            context.Rooms.AddRange(
                CreateRoom(100, 10),
                CreateRoom(200, 20),
                CreateRoom(300, 30));
            await context.SaveChangesAsync();
            return harness;
        }

        public KoochDbContext CreateContext() => new(options);

        public ServiceScope CreateService(TestReservationPricingService? pricing = null)
        {
            var context = CreateContext();
            var notificationDispatcher = new RecordingReservationNotificationDispatcher();
            var service = new BookingSessionService(
                context,
                new EffectiveAvailabilityService(context),
                pricing ?? new TestReservationPricingService(),
                new ReservationStatusWorkflow(),
                new ReservationNumberGenerator(context),
                new BookingSessionCodeGenerator(),
                notificationDispatcher);
            return new ServiceScope(context, service, notificationDispatcher);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private static RoomType CreateRoomType(
            int id,
            int propertyId,
            int inventory,
            InventoryMode inventoryMode = InventoryMode.NamedRooms) =>
            new()
            {
                Id = id,
                PropertyId = propertyId,
                Name = $"Room Type {id}",
                Slug = $"room-type-{id}",
                Description = "Test room type",
                MaxAdults = 2,
                MaxChildren = 2,
                TotalInventory = inventory,
                InventoryMode = inventoryMode,
                BasePrice = 100,
                IsActive = true
            };

        private static Room CreateRoom(int id, int roomTypeId) =>
            new()
            {
                Id = id,
                RoomTypeId = roomTypeId,
                Name = $"Room {id}",
                IsActive = true
            };
    }

    private sealed class ServiceScope(
        KoochDbContext context,
        BookingSessionService service,
        RecordingReservationNotificationDispatcher notificationDispatcher) : IAsyncDisposable
    {
        public BookingSessionService Service { get; } = service;
        public RecordingReservationNotificationDispatcher NotificationDispatcher { get; } = notificationDispatcher;

        public async ValueTask DisposeAsync()
        {
            await context.DisposeAsync();
        }
    }

    private sealed class TestReservationPricingService : IReservationPricingService
    {
        private int callCount;
        private int publicCallCount;

        public int? ThrowOnCall { get; init; }
        public int? ThrowOnPublicCall { get; init; }
        public Func<int, string> CurrencyForRoomType { get; init; } = _ => "IRR";

        public Task<ReservationPricePreviewResponse> PreviewReservationPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default)
        {
            var currentCall = Interlocked.Increment(ref callCount);
            if (ThrowOnCall == currentCall)
            {
                throw new InvalidOperationException("Pricing failed for the requested item.");
            }

            return Price(request);
        }

        public Task<ReservationPricePreviewResponse> PreviewPublicBookingPriceAsync(
            ReservationPricePreviewRequest request,
            CancellationToken cancellationToken = default)
        {
            var currentCall = Interlocked.Increment(ref publicCallCount);
            if (ThrowOnPublicCall == currentCall)
            {
                throw new IncompleteDailyPricingException(
                    request.RoomTypeId,
                    [request.CheckInDate]);
            }

            return Price(request);
        }

        private Task<ReservationPricePreviewResponse> Price(
            ReservationPricePreviewRequest request) =>
            Task.FromResult(new ReservationPricePreviewResponse
            {
                PropertyId = request.PropertyId,
                RoomTypeId = request.RoomTypeId,
                GuestType = request.GuestType,
                CheckInDate = request.CheckInDate,
                CheckOutDate = request.CheckOutDate,
                NightsCount = request.CheckOutDate.DayNumber - request.CheckInDate.DayNumber,
                Adults = request.Adults,
                Children = request.Children,
                RoomCount = 1,
                BaseAmount = 100,
                FinalAmount = 100,
                Currency = CurrencyForRoomType(request.RoomTypeId)
            });
    }
}
