using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddHolidayCalendarPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HolidayCalendarDays",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GregorianDate = table.Column<DateOnly>(type: "date", nullable: false),
                    SolarYear = table.Column<int>(type: "int", nullable: false),
                    SolarMonth = table.Column<int>(type: "int", nullable: false),
                    SolarDay = table.Column<int>(type: "int", nullable: false),
                    DayOfWeek = table.Column<int>(type: "int", nullable: false),
                    IsWeeklyHoliday = table.Column<bool>(type: "bit", nullable: false),
                    IsOfficialHoliday = table.Column<bool>(type: "bit", nullable: false),
                    ProviderName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    SourceSolarYear = table.Column<int>(type: "int", nullable: false),
                    LastProviderSyncAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HolidayCalendarDays", x => x.Id);
                    table.CheckConstraint("CK_HolidayCalendarDays_DayOfWeek", "[DayOfWeek] BETWEEN 0 AND 6");
                    table.CheckConstraint("CK_HolidayCalendarDays_HolidayClassification", "([IsWeeklyHoliday] = 1 AND [IsOfficialHoliday] = 0 AND [DayOfWeek] = 5) OR ([IsWeeklyHoliday] = 0 AND [IsOfficialHoliday] = 1 AND [DayOfWeek] <> 5)");
                });

            migrationBuilder.CreateTable(
                name: "HolidayCalendarSyncStates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ProviderName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    LastAttemptAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    LastSuccessfulSyncAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    LastSuccessfulSolarYearFrom = table.Column<int>(type: "int", nullable: true),
                    LastSuccessfulSolarYearTo = table.Column<int>(type: "int", nullable: true),
                    LastResponseHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    LastErrorSummary = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    LeaseOwner = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    LeaseExpiresAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HolidayCalendarSyncStates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HolidayCalendarDayOverrides",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    HolidayCalendarDayId = table.Column<int>(type: "int", nullable: false),
                    IsWeeklyHoliday = table.Column<bool>(type: "bit", nullable: true),
                    IsOfficialHoliday = table.Column<bool>(type: "bit", nullable: true),
                    Note = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HolidayCalendarDayOverrides", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HolidayCalendarDayOverrides_HolidayCalendarDays_HolidayCalendarDayId",
                        column: x => x.HolidayCalendarDayId,
                        principalTable: "HolidayCalendarDays",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "HolidayCalendarOccasions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    HolidayCalendarDayId = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: false),
                    NormalizedTitle = table.Column<string>(type: "nvarchar(512)", maxLength: 512, nullable: false),
                    Source = table.Column<int>(type: "int", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HolidayCalendarOccasions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HolidayCalendarOccasions_HolidayCalendarDays_HolidayCalendarDayId",
                        column: x => x.HolidayCalendarDayId,
                        principalTable: "HolidayCalendarDays",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarDayOverrides_HolidayCalendarDayId",
                table: "HolidayCalendarDayOverrides",
                column: "HolidayCalendarDayId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarDays_GregorianDate",
                table: "HolidayCalendarDays",
                column: "GregorianDate",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarDays_SolarYear_SolarMonth",
                table: "HolidayCalendarDays",
                columns: new[] { "SolarYear", "SolarMonth" });

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarDays_SolarYear_SolarMonth_SolarDay",
                table: "HolidayCalendarDays",
                columns: new[] { "SolarYear", "SolarMonth", "SolarDay" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarOccasions_HolidayCalendarDayId",
                table: "HolidayCalendarOccasions",
                column: "HolidayCalendarDayId");

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarOccasions_HolidayCalendarDayId_Source_NormalizedTitle",
                table: "HolidayCalendarOccasions",
                columns: new[] { "HolidayCalendarDayId", "Source", "NormalizedTitle" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HolidayCalendarSyncStates_ProviderName",
                table: "HolidayCalendarSyncStates",
                column: "ProviderName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HolidayCalendarDayOverrides");

            migrationBuilder.DropTable(
                name: "HolidayCalendarOccasions");

            migrationBuilder.DropTable(
                name: "HolidayCalendarSyncStates");

            migrationBuilder.DropTable(
                name: "HolidayCalendarDays");
        }
    }
}
