namespace Kooch.Api.Services.Svg;

public static class SvgSanitizationMessages
{
    public static string For(SvgSanitizationFailure failure) => failure switch
    {
        SvgSanitizationFailure.EmptyInput => "فایل SVG خالی است.",
        SvgSanitizationFailure.TooLarge => "حجم فایل SVG بیش از حد مجاز است.",
        SvgSanitizationFailure.InvalidXml => "فایل SVG معتبر نیست.",
        SvgSanitizationFailure.UnsupportedStructure => "ساختار این فایل SVG پشتیبانی نمی‌شود.",
        SvgSanitizationFailure.UnsafeContent => "فایل SVG شامل محتوای غیرمجاز است.",
        _ => "فایل SVG معتبر نیست."
    };
}
