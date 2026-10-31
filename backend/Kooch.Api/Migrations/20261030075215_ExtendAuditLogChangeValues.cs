using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class ExtendAuditLogChangeValues : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NewValuesJson",
                table: "AuditLogs",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PreviousValuesJson",
                table: "AuditLogs",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_Action_OccurredAtUtc_Id",
                table: "AuditLogs",
                columns: new[] { "Action", "OccurredAtUtc", "Id" },
                descending: new[] { false, true, true });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_OccurredAtUtc_Id",
                table: "AuditLogs",
                columns: new[] { "OccurredAtUtc", "Id" },
                descending: new bool[0]);

            migrationBuilder.AddCheckConstraint(
                name: "CK_AuditLogs_NewValuesJson",
                table: "AuditLogs",
                sql: "[NewValuesJson] IS NULL OR ISJSON([NewValuesJson]) = 1");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AuditLogs_PreviousValuesJson",
                table: "AuditLogs",
                sql: "[PreviousValuesJson] IS NULL OR ISJSON([PreviousValuesJson]) = 1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AuditLogs_Action_OccurredAtUtc_Id",
                table: "AuditLogs");

            migrationBuilder.DropIndex(
                name: "IX_AuditLogs_OccurredAtUtc_Id",
                table: "AuditLogs");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AuditLogs_NewValuesJson",
                table: "AuditLogs");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AuditLogs_PreviousValuesJson",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "NewValuesJson",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "PreviousValuesJson",
                table: "AuditLogs");
        }
    }
}
