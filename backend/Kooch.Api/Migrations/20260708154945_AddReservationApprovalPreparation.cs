using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationApprovalPreparation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ApprovedAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ApprovedByUserId",
                table: "Reservations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CancelledByUserId",
                table: "Reservations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PaymentExpiresAtUtc",
                table: "Reservations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_ApprovedByUserId",
                table: "Reservations",
                column: "ApprovedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_CancelledByUserId",
                table: "Reservations",
                column: "CancelledByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Reservations_Status_PaymentExpiresAtUtc",
                table: "Reservations",
                columns: new[] { "Status", "PaymentExpiresAtUtc" });

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_Users_ApprovedByUserId",
                table: "Reservations",
                column: "ApprovedByUserId",
                principalTable: "Users",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Reservations_Users_CancelledByUserId",
                table: "Reservations",
                column: "CancelledByUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_Users_ApprovedByUserId",
                table: "Reservations");

            migrationBuilder.DropForeignKey(
                name: "FK_Reservations_Users_CancelledByUserId",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_ApprovedByUserId",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_CancelledByUserId",
                table: "Reservations");

            migrationBuilder.DropIndex(
                name: "IX_Reservations_Status_PaymentExpiresAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "ApprovedAtUtc",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "ApprovedByUserId",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "CancelledByUserId",
                table: "Reservations");

            migrationBuilder.DropColumn(
                name: "PaymentExpiresAtUtc",
                table: "Reservations");
        }
    }
}
