using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBookingTravelerSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TravelerEmailSnapshot",
                table: "Reservations",
                type: "nvarchar(320)",
                maxLength: 320,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerFirstNameSnapshot",
                table: "Reservations",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerLastNameSnapshot",
                table: "Reservations",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerMobileSnapshot",
                table: "Reservations",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerNationalCodeSnapshot",
                table: "Reservations",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TravelerSnapshotCapturedAtUtc",
                table: "Reservations",
                type: "datetime2(7)",
                nullable: true);

            migrationBuilder.AddColumn<byte>(
                name: "TravelerSnapshotKind",
                table: "Reservations",
                type: "tinyint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerEmailSnapshot",
                table: "BookingSessions",
                type: "nvarchar(320)",
                maxLength: 320,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerFirstNameSnapshot",
                table: "BookingSessions",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerLastNameSnapshot",
                table: "BookingSessions",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerMobileSnapshot",
                table: "BookingSessions",
                type: "nvarchar(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TravelerNationalCodeSnapshot",
                table: "BookingSessions",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "TravelerSnapshotCapturedAtUtc",
                table: "BookingSessions",
                type: "datetime2(7)",
                nullable: true);

            migrationBuilder.AddColumn<byte>(
                name: "TravelerSnapshotKind",
                table: "BookingSessions",
                type: "tinyint",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Reservations_TravelerSnapshot",
                table: "Reservations",
                sql: "([TravelerSnapshotKind] IS NULL AND [TravelerFirstNameSnapshot] IS NULL AND [TravelerLastNameSnapshot] IS NULL AND [TravelerMobileSnapshot] IS NULL AND [TravelerEmailSnapshot] IS NULL AND [TravelerNationalCodeSnapshot] IS NULL AND [TravelerSnapshotCapturedAtUtc] IS NULL) OR ([TravelerSnapshotKind] IS NOT NULL AND [TravelerSnapshotKind] IN (1, 2) AND [TravelerSnapshotCapturedAtUtc] IS NOT NULL AND [TravelerFirstNameSnapshot] IS NOT NULL AND LEN(LTRIM(RTRIM([TravelerFirstNameSnapshot]))) > 0 AND [TravelerLastNameSnapshot] IS NOT NULL AND LEN(LTRIM(RTRIM([TravelerLastNameSnapshot]))) > 0)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_BookingSessions_TravelerSnapshot",
                table: "BookingSessions",
                sql: "([TravelerSnapshotKind] IS NULL AND [TravelerFirstNameSnapshot] IS NULL AND [TravelerLastNameSnapshot] IS NULL AND [TravelerMobileSnapshot] IS NULL AND [TravelerEmailSnapshot] IS NULL AND [TravelerNationalCodeSnapshot] IS NULL AND [TravelerSnapshotCapturedAtUtc] IS NULL) OR ([TravelerSnapshotKind] IS NOT NULL AND [TravelerSnapshotKind] IN (1, 2) AND [TravelerSnapshotCapturedAtUtc] IS NOT NULL AND [TravelerFirstNameSnapshot] IS NOT NULL AND LEN(LTRIM(RTRIM([TravelerFirstNameSnapshot]))) > 0 AND [TravelerLastNameSnapshot] IS NOT NULL AND LEN(LTRIM(RTRIM([TravelerLastNameSnapshot]))) > 0)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Reservations_TravelerSnapshot",
                table: "Reservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_BookingSessions_TravelerSnapshot",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerEmailSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerFirstNameSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerLastNameSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerMobileSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerNationalCodeSnapshot",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerSnapshotCapturedAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerSnapshotKind",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "TravelerEmailSnapshot",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerFirstNameSnapshot",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerLastNameSnapshot",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerMobileSnapshot",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerNationalCodeSnapshot",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerSnapshotCapturedAtUtc",
                table: "BookingSessions");

            migrationBuilder.DropColumn(
                name: "TravelerSnapshotKind",
                table: "BookingSessions");
        }
    }
}
