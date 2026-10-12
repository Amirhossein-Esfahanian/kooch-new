using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPropertyReceptionAndSameNightBookingSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<TimeOnly>(
                name: "RegularReceptionFrom",
                table: "Properties",
                type: "time",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "RegularReceptionUntil",
                table: "Properties",
                type: "time",
                nullable: true);

            migrationBuilder.AddColumn<short>(
                name: "SameNightFinalBookingDayOffset",
                table: "Properties",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "SameNightFinalBookingTime",
                table: "Properties",
                type: "time",
                nullable: true);

            migrationBuilder.AddColumn<short>(
                name: "SameNightInstantBookingDayOffset",
                table: "Properties",
                type: "smallint",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "SameNightInstantBookingTime",
                table: "Properties",
                type: "time",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RegularReceptionFrom",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "RegularReceptionUntil",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "SameNightFinalBookingDayOffset",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "SameNightFinalBookingTime",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "SameNightInstantBookingDayOffset",
                table: "Properties");

            migrationBuilder.DropColumn(
                name: "SameNightInstantBookingTime",
                table: "Properties");
        }
    }
}
