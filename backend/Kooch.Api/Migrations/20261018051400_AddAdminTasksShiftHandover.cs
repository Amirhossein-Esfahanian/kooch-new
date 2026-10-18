using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAdminTasksShiftHandover : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AdminTasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(250)", maxLength: 250, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    Priority = table.Column<int>(type: "int", nullable: false),
                    DueAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    AssignedToUserId = table.Column<int>(type: "int", nullable: false),
                    ReservationId = table.Column<int>(type: "int", nullable: true),
                    Status = table.Column<int>(type: "int", nullable: false),
                    ResolutionNote = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
                    CompletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AdminTasks", x => x.Id);
                    table.CheckConstraint("CK_AdminTasks_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_AdminTasks_Priority", "[Priority] IN (0, 1, 2)");
                    table.CheckConstraint("CK_AdminTasks_Status", "[Status] IN (0, 1, 2, 3)");
                    table.ForeignKey(
                        name: "FK_AdminTasks_Reservations_ReservationId",
                        column: x => x.ReservationId,
                        principalTable: "Reservations",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_AdminTasks_Users_AssignedToUserId",
                        column: x => x.AssignedToUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_AdminTasks_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "AdminTaskChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    AdminTaskId = table.Column<int>(type: "int", nullable: false),
                    ActorUserId = table.Column<int>(type: "int", nullable: false),
                    ActorDisplayName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    ChangeType = table.Column<int>(type: "int", nullable: false),
                    OccurredAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    PreviousStatus = table.Column<int>(type: "int", nullable: true),
                    NewStatus = table.Column<int>(type: "int", nullable: true),
                    PreviousAssigneeUserId = table.Column<int>(type: "int", nullable: true),
                    NewAssigneeUserId = table.Column<int>(type: "int", nullable: true),
                    ResolutionNote = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true),
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
                    table.PrimaryKey("PK_AdminTaskChanges", x => x.Id);
                    table.CheckConstraint("CK_AdminTaskChanges_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_AdminTaskChanges_Type", "[ChangeType] IN (0, 1, 2)");
                    table.ForeignKey(
                        name: "FK_AdminTaskChanges_AdminTasks_AdminTaskId",
                        column: x => x.AdminTaskId,
                        principalTable: "AdminTasks",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_AdminTaskChanges_Users_ActorUserId",
                        column: x => x.ActorUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_AdminTaskChanges_ActorUserId",
                table: "AdminTaskChanges",
                column: "ActorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_AdminTaskChanges_AdminTaskId_OccurredAtUtc_Id",
                table: "AdminTaskChanges",
                columns: new[] { "AdminTaskId", "OccurredAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_AdminTasks_AssignedToUserId_Status_DueAtUtc",
                table: "AdminTasks",
                columns: new[] { "AssignedToUserId", "Status", "DueAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_AdminTasks_CreatedByUserId",
                table: "AdminTasks",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_AdminTasks_ReservationId",
                table: "AdminTasks",
                column: "ReservationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AdminTaskChanges");

            migrationBuilder.DropTable(
                name: "AdminTasks");
        }
    }
}
