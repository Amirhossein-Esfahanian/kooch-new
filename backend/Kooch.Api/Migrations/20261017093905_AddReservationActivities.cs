using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReservationActivities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReservationActivities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReservationId = table.Column<int>(type: "int", nullable: false),
                    ActorUserId = table.Column<int>(type: "int", nullable: true),
                    ActorDisplayName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ActivityType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    Visibility = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Details = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    OccurredAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RelatedEntityType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    RelatedEntityId = table.Column<int>(type: "int", nullable: true),
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
                    table.PrimaryKey("PK_ReservationActivities", x => x.Id);
                    table.CheckConstraint("CK_ReservationActivities_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_ReservationActivities_RelatedEntityPair", "([RelatedEntityType] IS NULL AND [RelatedEntityId] IS NULL) OR ([RelatedEntityType] IS NOT NULL AND [RelatedEntityId] > 0)");
                    table.CheckConstraint("CK_ReservationActivities_Visibility", "[Visibility] IN (0, 1)");
                    table.ForeignKey(
                        name: "FK_ReservationActivities_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReservationActivities_Users_ActorUserId",
                        column: x => x.ActorUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReservationActivities_ActorUserId",
                table: "ReservationActivities",
                column: "ActorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ReservationActivities_ReservationId_OccurredAtUtc_Id",
                table: "ReservationActivities",
                columns: new[] { "ReservationId", "OccurredAtUtc", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReservationActivities");
        }
    }
}
