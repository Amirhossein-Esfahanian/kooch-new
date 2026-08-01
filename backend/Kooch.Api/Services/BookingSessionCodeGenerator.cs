using System.Security.Cryptography;

namespace Kooch.Api.Services;

public sealed class BookingSessionCodeGenerator : IBookingSessionCodeGenerator
{
    private const string Prefix = "KCH-S-";
    private const int RandomByteCount = 13;

    public string Generate()
    {
        Span<byte> bytes = stackalloc byte[RandomByteCount];
        RandomNumberGenerator.Fill(bytes);
        return $"{Prefix}{Convert.ToHexString(bytes)}";
    }
}
