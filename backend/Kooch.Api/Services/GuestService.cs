using Kooch.Api.Data;
using Kooch.Api.Dtos.Guests;
using Kooch.Api.Entities;
using Kooch.Api.Utilities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public class GuestService(KoochDbContext dbContext) : IGuestService
{
    private const string DuplicateGuestMessage = "مهمانی با این اطلاعات قبلاً ثبت شده است.";

    public async Task<GuestResponse> GetAsync(int id, CancellationToken cancellationToken = default)
    {
        var guest = await dbContext.Guests.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Guest not found.");

        return Map(guest);
    }

    public async Task<IReadOnlyList<GuestResponse>> SearchAsync(
        GuestSearchRequest query,
        CancellationToken cancellationToken = default)
    {
        var guests = query.IncludeDeleted
            ? dbContext.Guests.IgnoreQueryFilters().AsNoTracking()
            : dbContext.Guests.AsNoTracking();

        var searchText = GuestNormalization.NormalizeText(query.Query);
        if (searchText is not null)
        {
            guests = guests.Where(guest =>
                guest.FirstName.Contains(searchText) ||
                guest.LastName.Contains(searchText) ||
                (guest.Email != null && guest.Email.Contains(searchText)) ||
                (guest.Mobile != null && guest.Mobile.Contains(searchText)) ||
                (guest.NationalCode != null && guest.NationalCode.Contains(searchText)) ||
                (guest.PassportNumber != null && guest.PassportNumber.Contains(searchText)));
        }

        var mobile = GuestNormalization.NormalizeMobile(query.Mobile);
        if (mobile is not null)
        {
            guests = guests.Where(guest => guest.NormalizedMobile == mobile);
        }

        var email = GuestNormalization.NormalizeEmail(query.Email);
        if (email is not null)
        {
            guests = guests.Where(guest => guest.NormalizedEmail == email);
        }

        var nationalCode = GuestNormalization.NormalizeNationalCode(query.NationalCode);
        if (nationalCode is not null)
        {
            guests = guests.Where(guest => guest.NationalCode == nationalCode);
        }

        var passportNumber = NormalizePassportNumber(query.PassportNumber);
        if (passportNumber is not null)
        {
            guests = guests.Where(guest => guest.PassportNumber == passportNumber);
        }

        var page = Math.Max(query.Page, 1);
        var pageSize = Math.Clamp(query.PageSize, 1, 100);

        return await guests
            .OrderByDescending(guest => guest.CreatedAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(guest => Map(guest))
            .ToListAsync(cancellationToken);
    }

    public async Task<GuestResponse> CreateAsync(
        GuestCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        var normalized = Normalize(request);
        await EnsureNoDuplicateAsync(normalized, null, cancellationToken);

        var guest = new Guest();
        Apply(guest, normalized);

        dbContext.Guests.Add(guest);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Map(guest);
    }

    public async Task<GuestResponse> UpdateAsync(
        int id,
        GuestUpdateRequest request,
        CancellationToken cancellationToken = default)
    {
        var guest = await dbContext.Guests
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Guest not found.");

        var normalized = Normalize(request);
        await EnsureNoDuplicateAsync(normalized, id, cancellationToken);

        Apply(guest, normalized);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Map(guest);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var guest = await dbContext.Guests
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            ?? throw new KeyNotFoundException("Guest not found.");

        guest.IsDeleted = true;
        guest.DeletedAtUtc = DateTime.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureNoDuplicateAsync(
        NormalizedGuestInput input,
        int? currentGuestId,
        CancellationToken cancellationToken)
    {
        if (input.NormalizedMobile is null &&
            input.NormalizedEmail is null &&
            input.NationalCode is null &&
            input.PassportNumber is null)
        {
            return;
        }

        var duplicateExists = await dbContext.Guests.AsNoTracking()
            .AnyAsync(guest =>
                    (!currentGuestId.HasValue || guest.Id != currentGuestId.Value) &&
                    ((input.NormalizedMobile != null && guest.NormalizedMobile == input.NormalizedMobile) ||
                     (input.NormalizedEmail != null && guest.NormalizedEmail == input.NormalizedEmail) ||
                     (input.NationalCode != null && guest.NationalCode == input.NationalCode) ||
                     (input.PassportNumber != null && guest.PassportNumber == input.PassportNumber)),
                cancellationToken);

        if (duplicateExists)
        {
            throw new ArgumentException(DuplicateGuestMessage);
        }
    }

    private static NormalizedGuestInput Normalize(GuestCreateRequest request) => new(
        GuestNormalization.NormalizeText(request.FirstName),
        GuestNormalization.NormalizeText(request.LastName),
        GuestNormalization.NormalizeText(request.FullName),
        GuestNormalization.NormalizeMobile(request.Mobile),
        GuestNormalization.NormalizeEmail(request.Email),
        GuestNormalization.NormalizeNationalCode(request.NationalCode),
        NormalizePassportNumber(request.PassportNumber),
        GuestNormalization.NormalizeText(request.Nationality),
        request.BirthDate,
        GuestNormalization.NormalizeText(request.Gender),
        GuestNormalization.NormalizeText(request.Address),
        GuestNormalization.NormalizeText(request.Notes));

    private static NormalizedGuestInput Normalize(GuestUpdateRequest request) => new(
        GuestNormalization.NormalizeText(request.FirstName),
        GuestNormalization.NormalizeText(request.LastName),
        GuestNormalization.NormalizeText(request.FullName),
        GuestNormalization.NormalizeMobile(request.Mobile),
        GuestNormalization.NormalizeEmail(request.Email),
        GuestNormalization.NormalizeNationalCode(request.NationalCode),
        NormalizePassportNumber(request.PassportNumber),
        GuestNormalization.NormalizeText(request.Nationality),
        request.BirthDate,
        GuestNormalization.NormalizeText(request.Gender),
        GuestNormalization.NormalizeText(request.Address),
        GuestNormalization.NormalizeText(request.Notes));

    private static void Apply(Guest guest, NormalizedGuestInput input)
    {
        var (firstName, lastName) = ResolveName(input.FirstName, input.LastName, input.FullName);

        guest.FirstName = firstName;
        guest.LastName = lastName;
        guest.Mobile = input.NormalizedMobile;
        guest.NormalizedMobile = input.NormalizedMobile;
        guest.Email = input.NormalizedEmail;
        guest.NormalizedEmail = input.NormalizedEmail;
        guest.NationalCode = input.NationalCode;
        guest.PassportNumber = input.PassportNumber;
        guest.Nationality = input.Nationality;
        guest.BirthDate = input.BirthDate;
        guest.Gender = input.Gender;
        guest.Address = input.Address;
        guest.Notes = input.Notes;
    }

    private static (string FirstName, string LastName) ResolveName(
        string? firstName,
        string? lastName,
        string? fullName)
    {
        if (firstName is not null || lastName is not null)
        {
            return (firstName ?? string.Empty, lastName ?? string.Empty);
        }

        if (fullName is null)
        {
            return (string.Empty, string.Empty);
        }

        var parts = fullName.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 1
            ? (parts[0], string.Empty)
            : (parts[0], parts[1]);
    }

    private static string? NormalizePassportNumber(string? passportNumber) =>
        GuestNormalization.NormalizeText(passportNumber)?.ToUpperInvariant();

    private static GuestResponse Map(Guest guest) => new()
    {
        Id = guest.Id,
        FirstName = GuestNormalization.NormalizeText(guest.FirstName),
        LastName = GuestNormalization.NormalizeText(guest.LastName),
        FullName = guest.FullName,
        Mobile = guest.Mobile,
        Email = guest.Email,
        NationalCode = guest.NationalCode,
        PassportNumber = guest.PassportNumber,
        Nationality = guest.Nationality,
        BirthDate = guest.BirthDate,
        Gender = guest.Gender,
        Address = guest.Address,
        Notes = guest.Notes
    };

    private sealed record NormalizedGuestInput(
        string? FirstName,
        string? LastName,
        string? FullName,
        string? NormalizedMobile,
        string? NormalizedEmail,
        string? NationalCode,
        string? PassportNumber,
        string? Nationality,
        DateOnly? BirthDate,
        string? Gender,
        string? Address,
        string? Notes);
}
