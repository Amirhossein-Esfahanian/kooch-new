using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddGuestReviewModeration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ModeratedAtUtc",
                table: "Reviews",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ModeratedByUserId",
                table: "Reviews",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RejectionReason",
                table: "Reviews",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_ModeratedByUserId",
                table: "Reviews",
                column: "ModeratedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Reviews_Users_ModeratedByUserId",
                table: "Reviews",
                column: "ModeratedByUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Reviews_Users_ModeratedByUserId",
                table: "Reviews");

            migrationBuilder.DropIndex(
                name: "IX_Reviews_ModeratedByUserId",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "ModeratedAtUtc",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "ModeratedByUserId",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "RejectionReason",
                table: "Reviews");
        }
    }
}
