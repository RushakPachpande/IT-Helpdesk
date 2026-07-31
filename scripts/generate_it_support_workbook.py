#!/usr/bin/env python3
"""
Generate a production-ready IT Support Tickets Excel workbook for the
n8n IT Helpdesk Ticketing System.

Usage:
    python generate_it_support_workbook.py
    python generate_it_support_workbook.py --output path/to/IT Support Tickets.xlsx

Requires: openpyxl>=3.1
"""

from __future__ import annotations

import argparse
import re
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from openpyxl import Workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HEADER_FILL = PatternFill("solid", fgColor="0056B3")
HEADER_FONT = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
TITLE_FONT = Font(bold=True, name="Calibri", size=16, color="0056B3")
SECTION_FONT = Font(bold=True, name="Calibri", size=12, color="1E293B")
THIN = Border(
    left=Side(style="thin", color="CBD5E1"),
    right=Side(style="thin", color="CBD5E1"),
    top=Side(style="thin", color="CBD5E1"),
    bottom=Side(style="thin", color="CBD5E1"),
)

FILL_OPEN = PatternFill("solid", fgColor="FECACA")       # red-ish
FILL_IN_PROGRESS = PatternFill("solid", fgColor="FED7AA")  # orange
FILL_PENDING = PatternFill("solid", fgColor="FEF08A")    # yellow
FILL_CLOSED = PatternFill("solid", fgColor="BBF7D0")     # green
FILL_HIGH = PatternFill("solid", fgColor="FCA5A5")
FILL_MISSING = PatternFill("solid", fgColor="FDE68A")
FILL_OVERDUE = PatternFill("solid", fgColor="F87171")

TICKET_COLUMNS = [
    "Ticket ID",
    "Created Date",
    "Created Time",
    "Requester Name",
    "Requester Email",
    "CC Emails",
    "Subject",
    "Email Body",
    "Priority",
    "Category",
    "Department",
    "Status",
    "Assigned Engineer",
    "Conversation ID",
    "Internet Message ID",
    "Conversation Index",
    "Message Id",
    "Folder",
    "Last Updated",
    "Closed Date",
    "Resolution Notes",
    "Internal Remarks",
    "Escalation Level",
    "Resolution",
    "Closure Reason",
    "Processing Stage",
    "Ack Sent",
    "AI Issue Summary",
    "AI Priority",
    "AI Scope",
    "Ticket Age Days",
    "SLA Remaining Hours",
]

AUDIT_COLUMNS = [
    "Timestamp",
    "Event",
    "Ticket ID",
    "Conversation ID",
    "Message Id",
    "Detail",
]

STATUSES = ["New", "Open", "In Progress", "Pending", "Needs Review", "Closed"]
PRIORITIES = ["High", "Medium", "Low"]
AI_PRIORITIES = ["Critical", "High", "Medium", "Low"]
PROCESSING_STAGES = ["Created", "Acked", "Complete", "NeedsReview"]
ACK_SENT_VALUES = ["Yes", "No"]


def col_index(name: str) -> int:
    """1-based column index for a Tickets header."""
    try:
        return TICKET_COLUMNS.index(name) + 1
    except ValueError as exc:
        raise KeyError(f"Unknown ticket column: {name}") from exc


def col_letter(name: str) -> str:
    return get_column_letter(col_index(name))
CATEGORIES = [
    "Hardware",
    "Software",
    "Network",
    "Email",
    "Access / Accounts",
    "Security",
    "Printer",
    "Other",
]
DEPARTMENTS = [
    "IT",
    "HR",
    "Finance",
    "Sales",
    "Operations",
    "Marketing",
    "Engineering",
    "Other",
]
ENGINEERS = [
    "Unassigned",
    "Rushak Pachpande",
    "IT Engineer 1",
    "IT Engineer 2",
]
ESCALATION_LEVELS = ["L1", "L2", "L3", "Management"]
RESOLUTIONS = [
    "Resolved - User Assisted",
    "Resolved - Remote Fix",
    "Resolved - Onsite",
    "Resolved - Password Reset",
    "Resolved - Access Granted",
    "Duplicate",
    "Not Reproducible",
    "Escalated Externally",
    "Other",
]
CLOSURE_REASONS = [
    "Completed",
    "Cancelled by User",
    "Duplicate Ticket",
    "No Response from User",
    "Out of Scope",
    "Other",
]


def style_header_row(ws, row: int, col_count: int) -> None:
    for col in range(1, col_count + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = THIN


def autosize(ws, min_width: int = 12, max_width: int = 40) -> None:
    for col_cells in ws.columns:
        letter = get_column_letter(col_cells[0].column)
        length = 0
        for cell in col_cells:
            if cell.value is not None:
                length = max(length, min(len(str(cell.value)), max_width))
        ws.column_dimensions[letter].width = max(min_width, length + 2)


def add_list_validation(ws, col_letter: str, formula: str, allow_blank: bool = True) -> None:
    dv = DataValidation(
        type="list",
        formula1=formula,
        allow_blank=allow_blank,
        showDropDown=False,
        showErrorMessage=True,
        errorTitle="Invalid value",
        error="Please select a value from the dropdown list.",
    )
    dv.add(f"{col_letter}2:{col_letter}5000")
    ws.add_data_validation(dv)


def build_configuration(wb: Workbook) -> None:
    ws = wb.create_sheet("Configuration")
    ws["A1"] = "IT Support Ticketing — Configuration"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A1:B1")

    settings = [
        ("Company Prefix", "NGI"),
        ("Support Mailbox", "itsupport@nextgeninnov8.com"),
        ("Admin Alert Email", "it-admin@nextgeninnov8.com"),
        ("Expected Response Hours", 24),
        ("SLA High Hours", 4),
        ("SLA Medium Hours", 24),
        ("SLA Low Hours", 72),
        ("Ack Expected Response Text", "Our support team will follow up on this thread within 1 business day."),
        ("Timezone", "Asia/Kolkata"),
        ("Workbook Version", "2.0"),
        ("Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
    ]

    ws["A3"] = "Setting"
    ws["B3"] = "Value"
    style_header_row(ws, 3, 2)

    for i, (key, value) in enumerate(settings, start=4):
        ws.cell(row=i, column=1, value=key).border = THIN
        cell = ws.cell(row=i, column=2, value=value)
        cell.border = THIN

    # Named cells for SLA formulas (rows 8/9/10 = High/Medium/Low hours)
    # Excel named ranges cannot use spaces — keep underscore form here only.
    wb.defined_names.add(DefinedName(name="SLA_High", attr_text="Configuration!$B$8"))
    wb.defined_names.add(DefinedName(name="SLA_Medium", attr_text="Configuration!$B$9"))
    wb.defined_names.add(DefinedName(name="SLA_Low", attr_text="Configuration!$B$10"))

    ws["A16"] = "Notes"
    ws["A16"].font = SECTION_FONT
    ws["A17"] = (
        "Upload this workbook to OneDrive/SharePoint under the IT Support account. "
        "In n8n Excel nodes, reselect this workbook and the ITTickets / AuditLog tables after upload "
        "(workbook and table IDs are tenant-specific). "
        "CreatedDate / ClosedDate are real Excel dates (display dd-mm-yyyy). "
        "Processing Stage / Ack Sent enable fault-tolerant resume; AI columns hold LLM summaries. "
        "Outlook folders: Inbox, Open Tickets, Processed."
    )
    ws.merge_cells("A17:B19")
    ws["A17"].alignment = Alignment(wrap_text=True, vertical="top")

    autosize(ws)
    ws.column_dimensions["B"].width = 70


def build_list_sheet(wb: Workbook, title: str, header: str, values: list[str], named_range: str) -> None:
    ws = wb.create_sheet(title)
    ws["A1"] = header
    style_header_row(ws, 1, 1)
    for i, value in enumerate(values, start=2):
        cell = ws.cell(row=i, column=1, value=value)
        cell.border = THIN
    end_row = 1 + len(values)
    ref = f"'{title}'!$A$2:$A${end_row}"
    wb.defined_names.add(DefinedName(name=named_range, attr_text=ref))
    autosize(ws)


def build_categories(wb: Workbook) -> None:
    build_list_sheet(wb, "Categories", "Category", CATEGORIES, "List_Categories")


def build_users(wb: Workbook) -> None:
    ws = wb.create_sheet("Users")
    headers = ["DisplayName", "Email", "Role", "Active"]
    for col, h in enumerate(headers, start=1):
        ws.cell(row=1, column=col, value=h)
    style_header_row(ws, 1, len(headers))

    rows = [
        ("Rushak Pachpande", "rushak@nextgeninnov8.com", "Lead", "Yes"),
        ("IT Engineer 1", "engineer1@nextgeninnov8.com", "Engineer", "Yes"),
        ("IT Engineer 2", "engineer2@nextgeninnov8.com", "Engineer", "Yes"),
        ("Unassigned", "", "Placeholder", "Yes"),
    ]
    for r, row in enumerate(rows, start=2):
        for c, val in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=val)
            cell.border = THIN

    # Named range for Assigned Engineer dropdown (DisplayName column)
    wb.defined_names.add(DefinedName(name="List_Engineers", attr_text="'Users'!$A$2:$A$5"))
    # Also expose static lists as named ranges on hidden helper area
    ws["F1"] = "StatusList"
    for i, s in enumerate(STATUSES, start=2):
        ws.cell(row=i, column=6, value=s)
    ws["G1"] = "PriorityList"
    for i, p in enumerate(PRIORITIES, start=2):
        ws.cell(row=i, column=7, value=p)
    ws["H1"] = "DepartmentList"
    for i, d in enumerate(DEPARTMENTS, start=2):
        ws.cell(row=i, column=8, value=d)
    ws["I1"] = "EscalationList"
    for i, e in enumerate(ESCALATION_LEVELS, start=2):
        ws.cell(row=i, column=9, value=e)
    ws["J1"] = "ResolutionList"
    for i, r in enumerate(RESOLUTIONS, start=2):
        ws.cell(row=i, column=10, value=r)
    ws["K1"] = "ClosureReasonList"
    for i, c in enumerate(CLOSURE_REASONS, start=2):
        ws.cell(row=i, column=11, value=c)
    ws["L1"] = "ProcessingStageList"
    for i, s in enumerate(PROCESSING_STAGES, start=2):
        ws.cell(row=i, column=12, value=s)
    ws["M1"] = "AckSentList"
    for i, a in enumerate(ACK_SENT_VALUES, start=2):
        ws.cell(row=i, column=13, value=a)
    ws["N1"] = "AIPriorityList"
    for i, p in enumerate(AI_PRIORITIES, start=2):
        ws.cell(row=i, column=14, value=p)

    wb.defined_names.add(DefinedName(name="List_Status", attr_text=f"'Users'!$F$2:$F${1 + len(STATUSES)}"))
    wb.defined_names.add(DefinedName(name="List_Priority", attr_text=f"'Users'!$G$2:$G${1 + len(PRIORITIES)}"))
    wb.defined_names.add(DefinedName(name="List_Department", attr_text=f"'Users'!$H$2:$H${1 + len(DEPARTMENTS)}"))
    wb.defined_names.add(
        DefinedName(name="List_Escalation", attr_text=f"'Users'!$I$2:$I${1 + len(ESCALATION_LEVELS)}")
    )
    wb.defined_names.add(DefinedName(name="List_Resolution", attr_text=f"'Users'!$J$2:$J${1 + len(RESOLUTIONS)}"))
    wb.defined_names.add(
        DefinedName(name="List_ClosureReason", attr_text=f"'Users'!$K$2:$K${1 + len(CLOSURE_REASONS)}")
    )
    wb.defined_names.add(
        DefinedName(name="List_ProcessingStage", attr_text=f"'Users'!$L$2:$L${1 + len(PROCESSING_STAGES)}")
    )
    wb.defined_names.add(
        DefinedName(name="List_AckSent", attr_text=f"'Users'!$M$2:$M${1 + len(ACK_SENT_VALUES)}")
    )
    wb.defined_names.add(
        DefinedName(name="List_AIPriority", attr_text=f"'Users'!$N$2:$N${1 + len(AI_PRIORITIES)}")
    )

    autosize(ws)


def sample_tickets() -> list[list]:
    """A few sample rows so Dashboard formulas and charts render immediately.

    CreatedDate / ClosedDate are real date objects (not text) so age/SLA formulas
    never depend on locale-sensitive DATEVALUE().
    Formula columns (Ticket Age Days, SLA Remaining Hours) are filled later.
    """
    now = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    # Row values exclude the two trailing formula columns.
    data_cols = len(TICKET_COLUMNS) - 2
    rows = [
        [
            "NGI-310726-A7K9",
            now - timedelta(days=2),
            "09:15 AM",
            "Priya Sharma",
            "priya.sharma@nextgeninnov8.com",
            "manager@nextgeninnov8.com",
            "Cannot access VPN",
            "VPN client fails with error 809 after Windows update.",
            "High",
            "Network",
            "Engineering",
            "Open",
            "Rushak Pachpande",
            "AAQkAGSampleConv001",
            "<msg-sample-001@mail.outlook.com>",
            "",
            "AAMkAGSampleMsg001",
            "Open Tickets",
            now - timedelta(days=1),
            None,  # ClosedDate
            "",
            "Waiting on firewall team",
            "L1",
            "",
            "",
            "Complete",
            "Yes",
            "VPN connection fails with error 809 after a Windows update.",
            "High",
            "VPN client / Engineering user Priya Sharma",
        ],
        [
            "NGI-300726-4PXM",
            now - timedelta(days=3),
            "02:40 PM",
            "Amit Patel",
            "amit.patel@nextgeninnov8.com",
            "",
            "Outlook search not working",
            "Search returns no results for recent emails.",
            "Medium",
            "Email",
            "Sales",
            "In Progress",
            "IT Engineer 1",
            "AAQkAGSampleConv002",
            "<msg-sample-002@mail.outlook.com>",
            "",
            "AAMkAGSampleMsg002",
            "Open Tickets",
            now,
            None,
            "",
            "Rebuilding Outlook index",
            "L1",
            "",
            "",
            "Complete",
            "Yes",
            "Outlook search returns no results for recent mail.",
            "Medium",
            "Outlook / Sales user Amit Patel",
        ],
        [
            "NGI-280726-X2Q8",
            now - timedelta(days=5),
            "11:05 AM",
            "Neha Gupta",
            "neha.gupta@nextgeninnov8.com",
            "hr@nextgeninnov8.com",
            "New laptop setup request",
            "Need Windows 11 laptop setup for new joiner starting Monday.",
            "Low",
            "Hardware",
            "HR",
            "Closed",
            "IT Engineer 2",
            "AAQkAGSampleConv003",
            "<msg-sample-003@mail.outlook.com>",
            "",
            "AAMkAGSampleMsg003",
            "Processed",
            now - timedelta(days=1),
            now - timedelta(days=1),
            "Laptop imaged and delivered",
            "",
            "L1",
            "Resolved - Onsite",
            "Completed",
            "Complete",
            "Yes",
            "Request for Windows 11 laptop setup for a new joiner.",
            "Low",
            "Laptop / HR new joiner",
        ],
    ]
    for row in rows:
        if len(row) != data_cols:
            raise ValueError(f"Sample row length {len(row)} != {data_cols} data columns")
    return rows


def _ticket_age_formula(row: int) -> str:
    created = col_letter("Created Date")
    status = col_letter("Status")
    closed = col_letter("Closed Date")
    ticket_id = col_letter("Ticket ID")
    return (
        f'=IF({ticket_id}{row}="","",'
        f'IF({status}{row}="Closed",IF({closed}{row}="",0,MAX(0,{closed}{row}-{created}{row})),'
        f'MAX(0,TODAY()-{created}{row})))'
    )


def _ticket_sla_formula(row: int) -> str:
    ticket_id = col_letter("Ticket ID")
    status = col_letter("Status")
    priority = col_letter("Priority")
    age = col_letter("Ticket Age Days")
    return (
        f'=IF(OR({ticket_id}{row}="",{status}{row}="Closed"),"",'
        f'IF({priority}{row}="High",SLA_High,IF({priority}{row}="Low",SLA_Low,SLA_Medium))'
        f'-{age}{row}*24)'
    )


def build_tickets(wb: Workbook) -> None:
    ws = wb.create_sheet("Tickets")
    for col, name in enumerate(TICKET_COLUMNS, start=1):
        ws.cell(row=1, column=col, value=name)
    style_header_row(ws, 1, len(TICKET_COLUMNS))
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"
    # Do NOT set ws.auto_filter when using an Excel Table — dual filters corrupt refs in Excel.

    age_col = col_index("Ticket Age Days")
    sla_col = col_index("SLA Remaining Hours")
    created_col = col_index("Created Date")
    last_upd_col = col_index("Last Updated")
    closed_col = col_index("Closed Date")
    wrap_cols = {
        col_index("Subject"),
        col_index("Email Body"),
        col_index("Resolution Notes"),
        col_index("Internal Remarks"),
        col_index("AI Issue Summary"),
        col_index("AI Scope"),
    }

    samples = sample_tickets()
    for r_idx, row in enumerate(samples, start=2):
        for c_idx, val in enumerate(row, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=val)
            cell.border = THIN
            cell.alignment = Alignment(vertical="center", wrap_text=c_idx in wrap_cols)
            if c_idx in (created_col, last_upd_col, closed_col) and isinstance(val, datetime):
                cell.number_format = "dd-mm-yyyy"

        age_cell = ws.cell(row=r_idx, column=age_col, value=_ticket_age_formula(r_idx))
        age_cell.border = THIN
        age_cell.number_format = "0"

        sla_cell = ws.cell(row=r_idx, column=sla_col, value=_ticket_sla_formula(r_idx))
        sla_cell.border = THIN
        sla_cell.number_format = "0.0"

    end_col = get_column_letter(len(TICKET_COLUMNS))
    end_row = 1 + max(len(samples), 1)
    # Excel table names cannot contain spaces (openpyxl/Excel rule) — no underscore either.
    table = Table(displayName="ITTickets", ref=f"A1:{end_col}{end_row}")
    table.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2",
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
        showColumnStripes=False,
    )
    ws.add_table(table)

    add_list_validation(ws, col_letter("Priority"), "=List_Priority")
    add_list_validation(ws, col_letter("Category"), "=List_Categories")
    add_list_validation(ws, col_letter("Department"), "=List_Department")
    add_list_validation(ws, col_letter("Status"), "=List_Status")
    add_list_validation(ws, col_letter("Assigned Engineer"), "=List_Engineers")
    add_list_validation(ws, col_letter("Escalation Level"), "=List_Escalation")
    add_list_validation(ws, col_letter("Resolution"), "=List_Resolution")
    add_list_validation(ws, col_letter("Closure Reason"), "=List_ClosureReason")
    add_list_validation(ws, col_letter("Processing Stage"), "=List_ProcessingStage")
    add_list_validation(ws, col_letter("Ack Sent"), "=List_AckSent")
    add_list_validation(ws, col_letter("AI Priority"), "=List_AIPriority")

    status_letter = col_letter("Status")
    priority_letter = col_letter("Priority")
    engineer_letter = col_letter("Assigned Engineer")
    sla_letter = col_letter("SLA Remaining Hours")

    for status, fill in (
        ("Open", FILL_OPEN),
        ("New", FILL_OPEN),
        ("Needs Review", FILL_MISSING),
        ("In Progress", FILL_IN_PROGRESS),
        ("Pending", FILL_PENDING),
        ("Closed", FILL_CLOSED),
    ):
        ws.conditional_formatting.add(
            f"{status_letter}2:{status_letter}5000",
            CellIsRule(operator="equal", formula=[f'"{status}"'], fill=fill),
        )
    ws.conditional_formatting.add(
        f"{priority_letter}2:{priority_letter}5000",
        CellIsRule(operator="equal", formula=['"High"'], fill=FILL_HIGH),
    )
    ws.conditional_formatting.add(
        f"{engineer_letter}2:{engineer_letter}5000",
        CellIsRule(operator="equal", formula=['"Unassigned"'], fill=FILL_MISSING),
    )
    ws.conditional_formatting.add(
        f"{sla_letter}2:{sla_letter}5000",
        CellIsRule(operator="lessThan", formula=["0"], fill=FILL_OVERDUE),
    )

    autosize(ws)
    ws.column_dimensions[col_letter("Subject")].width = 36
    ws.column_dimensions[col_letter("Email Body")].width = 48
    ws.column_dimensions[col_letter("Resolution Notes")].width = 28
    ws.column_dimensions[col_letter("Internal Remarks")].width = 28
    ws.column_dimensions[col_letter("AI Issue Summary")].width = 40
    ws.column_dimensions[col_letter("AI Scope")].width = 28


def build_audit_log(wb: Workbook) -> None:
    ws = wb.create_sheet("Audit Log")
    for col, name in enumerate(AUDIT_COLUMNS, start=1):
        ws.cell(row=1, column=col, value=name)
    style_header_row(ws, 1, len(AUDIT_COLUMNS))
    ws.freeze_panes = "A2"

    sample = [
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ticket_created",
        "NGI-310726-A7K9",
        "AAQkAGSampleConv001",
        "AAMkAGSampleMsg001",
        "Sample audit entry — safe to delete",
    ]
    for c, val in enumerate(sample, start=1):
        cell = ws.cell(row=2, column=c, value=val)
        cell.border = THIN

    table = Table(displayName="AuditLog", ref="A1:F2")
    table.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium9",
        showRowStripes=True,
    )
    ws.add_table(table)
    autosize(ws)


def build_dashboard(wb: Workbook) -> None:
    """Dashboard uses Tickets! ranges (not table structured refs) to avoid #REF!
    when table names fail to resolve in Excel Online / after file rename.
    """
    ws = wb.create_sheet("Dashboard")
    ws["A1"] = "IT Support — Operations Dashboard"
    ws["A1"].font = TITLE_FONT
    ws.merge_cells("A1:D1")

    ws["A3"] = "Metric"
    ws["B3"] = "Value"
    style_header_row(ws, 3, 2)

    status_l = col_letter("Status")
    priority_l = col_letter("Priority")
    engineer_l = col_letter("Assigned Engineer")
    age_l = col_letter("Ticket Age Days")
    ticket_l = col_letter("Ticket ID")

    metrics = [
        ("Total Tickets", f'=COUNTA(Tickets!${ticket_l}$2:${ticket_l}$5000)'),
        (
            "Open (New+Open)",
            f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"New")'
            f'+COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Open")',
        ),
        ("In Progress", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"In Progress")'),
        ("Pending", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Pending")'),
        ("Needs Review", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Needs Review")'),
        ("Closed", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Closed")'),
        (
            "High Priority Open",
            f'=COUNTIFS(Tickets!${priority_l}$2:${priority_l}$5000,"High",'
            f'Tickets!${status_l}$2:${status_l}$5000,"<>Closed")',
        ),
        ("Unassigned", f'=COUNTIF(Tickets!${engineer_l}$2:${engineer_l}$5000,"Unassigned")'),
        (
            "Avg Age (Open Days)",
            f'=IFERROR(AVERAGEIF(Tickets!${status_l}$2:${status_l}$5000,"<>Closed",'
            f'Tickets!${age_l}$2:${age_l}$5000),0)',
        ),
    ]
    for i, (label, formula) in enumerate(metrics, start=4):
        ws.cell(row=i, column=1, value=label).border = THIN
        cell = ws.cell(row=i, column=2, value=formula)
        cell.border = THIN
        cell.font = Font(bold=True, name="Calibri", size=12)

    # Status breakdown for chart (labels text + numeric counts)
    ws["D3"] = "Status"
    ws["E3"] = "Count"
    for col in (4, 5):
        cell = ws.cell(row=3, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN

    status_rows = [
        ("New", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"New")'),
        ("Open", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Open")'),
        ("In Progress", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"In Progress")'),
        ("Pending", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Pending")'),
        ("Needs Review", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Needs Review")'),
        ("Closed", f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Closed")'),
    ]
    for i, (label, formula) in enumerate(status_rows, start=4):
        ws.cell(row=i, column=4, value=label).border = THIN
        ws.cell(row=i, column=5, value=formula).border = THIN

    pie = PieChart()
    pie.title = "Tickets by Status"
    labels = Reference(ws, min_col=4, min_row=4, max_row=9)
    data = Reference(ws, min_col=5, min_row=3, max_row=9)
    pie.add_data(data, titles_from_data=True)
    pie.set_categories(labels)
    pie.width = 12
    pie.height = 8
    ws.add_chart(pie, "A15")

    # Priority breakdown
    ws["G3"] = "Priority"
    ws["H3"] = "Count"
    for col in (7, 8):
        cell = ws.cell(row=3, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN

    for i, p in enumerate(PRIORITIES, start=4):
        ws.cell(row=i, column=7, value=p).border = THIN
        ws.cell(
            row=i,
            column=8,
            value=f'=COUNTIF(Tickets!${priority_l}$2:${priority_l}$5000,"{p}")',
        ).border = THIN

    bar = BarChart()
    bar.type = "col"
    bar.title = "Tickets by Priority"
    bar_data = Reference(ws, min_col=8, min_row=3, max_row=6)
    bar_cats = Reference(ws, min_col=7, min_row=4, max_row=6)
    bar.add_data(bar_data, titles_from_data=True)
    bar.set_categories(bar_cats)
    bar.shape = 4
    bar.width = 12
    bar.height = 8
    ws.add_chart(bar, "G15")

    ws["A25"] = "Engineer Workload (non-closed)"
    ws["A25"].font = SECTION_FONT
    ws["A26"] = "Engineer"
    ws["B26"] = "Open Tickets"
    style_header_row(ws, 26, 2)
    for i, eng in enumerate(ENGINEERS, start=27):
        ws.cell(row=i, column=1, value=eng).border = THIN
        ws.cell(
            row=i,
            column=2,
            value=(
                f'=COUNTIFS(Tickets!${engineer_l}$2:${engineer_l}$5000,A{i},'
                f'Tickets!${status_l}$2:${status_l}$5000,"<>Closed")'
            ),
        ).border = THIN

    autosize(ws)
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["D"].width = 14


def build_reports(wb: Workbook) -> None:
    ws = wb.create_sheet("Reports")
    ws["A1"] = "Monthly / Trend Reports"
    ws["A1"].font = TITLE_FONT

    cat_l = col_letter("Category")
    dept_l = col_letter("Department")
    status_l = col_letter("Status")
    ticket_l = col_letter("Ticket ID")

    ws["A3"] = "Category Statistics"
    ws["A3"].font = SECTION_FONT
    ws["A4"] = "Category"
    ws["B4"] = "Ticket Count"
    style_header_row(ws, 4, 2)
    for i, cat in enumerate(CATEGORIES, start=5):
        ws.cell(row=i, column=1, value=cat).border = THIN
        ws.cell(
            row=i,
            column=2,
            value=f'=COUNTIF(Tickets!${cat_l}$2:${cat_l}$5000,A{i})',
        ).border = THIN

    ws["D3"] = "Department Statistics"
    ws["D3"].font = SECTION_FONT
    ws["D4"] = "Department"
    ws["E4"] = "Ticket Count"
    for col in (4, 5):
        cell = ws.cell(row=4, column=col)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = THIN
    for i, dept in enumerate(DEPARTMENTS, start=5):
        ws.cell(row=i, column=4, value=dept).border = THIN
        ws.cell(
            row=i,
            column=5,
            value=f'=COUNTIF(Tickets!${dept_l}$2:${dept_l}$5000,D{i})',
        ).border = THIN

    ws["A16"] = "Closed / Open totals"
    ws["A16"].font = SECTION_FONT
    ws["A17"] = "Note: CreatedDate is a real Excel date — filter or pivot by month as needed."
    ws["A18"] = "Closed Count (all time)"
    ws["B18"] = f'=COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Closed")'
    ws["A19"] = "Open Count (all non-closed)"
    ws["B19"] = (
        f'=COUNTA(Tickets!${ticket_l}$2:${ticket_l}$5000)'
        f'-COUNTIF(Tickets!${status_l}$2:${status_l}$5000,"Closed")'
    )

    autosize(ws)


def _fix_chart_category_refs(xlsx_path: Path) -> None:
    """openpyxl emits numRef for text category axes → Excel shows #REF!/blank charts.
    Rewrite category refs to strRef.
    """
    import shutil

    tmp = xlsx_path.with_suffix(".tmp.xlsx")
    with zipfile.ZipFile(xlsx_path, "r") as zin, zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("xl/charts/") and item.filename.endswith(".xml"):
                text = data.decode("utf-8")
                # <cat><numRef><f>'Dashboard'!$D$4:$D$8</f></numRef></cat>
                # → <cat><strRef><f>...</f></strRef></cat>
                text = re.sub(
                    r"<cat><numRef>(<f>.*?</f>)</numRef></cat>",
                    r"<cat><strRef>\1</strRef></cat>",
                    text,
                )
                data = text.encode("utf-8")
            zout.writestr(item, data)
    shutil.move(tmp, xlsx_path)


def verify_workbook(xlsx_path: Path) -> list[str]:
    """Return a list of verification errors (empty = PASS)."""
    from openpyxl import load_workbook

    errors: list[str] = []
    wb = load_workbook(xlsx_path, data_only=False)

    required_sheets = [
        "Dashboard",
        "Tickets",
        "Configuration",
        "Categories",
        "Users",
        "Audit Log",
        "Reports",
    ]
    for name in required_sheets:
        if name not in wb.sheetnames:
            errors.append(f"Missing sheet: {name}")

    if "Tickets" in wb.sheetnames:
        ws = wb["Tickets"]
        headers = [ws.cell(1, c).value for c in range(1, len(TICKET_COLUMNS) + 1)]
        if headers != TICKET_COLUMNS:
            errors.append(
                f"Tickets headers mismatch.\n  expected={TICKET_COLUMNS}\n  actual={headers}"
            )
        tables = getattr(ws, "tables", {}) or {}
        if "ITTickets" not in tables:
            errors.append("Missing Excel table ITTickets on Tickets sheet")
        else:
            expected_ref = f"A1:{get_column_letter(len(TICKET_COLUMNS))}{max(ws.max_row, 2)}"
            actual_ref = tables["ITTickets"].ref
            # Allow table to cover sample rows; end col must match
            if not str(actual_ref).startswith(f"A1:{get_column_letter(len(TICKET_COLUMNS))}"):
                errors.append(f"ITTickets ref column mismatch: {actual_ref} (expected start {expected_ref})")

        # Age/SLA formulas must reference Status / Priority / Age letters derived from headers
        status_l = col_letter("Status")
        priority_l = col_letter("Priority")
        age_l = col_letter("Ticket Age Days")
        age_col = col_index("Ticket Age Days")
        sla_col = col_index("SLA Remaining Hours")
        for r in range(2, min(ws.max_row, 5) + 1):
            age_f = ws.cell(r, age_col).value
            sla_f = ws.cell(r, sla_col).value
            if not isinstance(age_f, str) or not age_f.startswith("="):
                errors.append(f"Tickets!{get_column_letter(age_col)}{r} missing age formula")
            elif f"{status_l}{r}" not in age_f:
                errors.append(f"Age formula row {r} missing Status col {status_l}")
            if not isinstance(sla_f, str) or not sla_f.startswith("="):
                errors.append(f"Tickets!{get_column_letter(sla_col)}{r} missing SLA formula")
            elif f"{priority_l}{r}" not in sla_f or f"{age_l}{r}" not in sla_f:
                errors.append(f"SLA formula row {r} missing Priority/Age refs")

        for required in (
            "Processing Stage",
            "Ack Sent",
            "AI Issue Summary",
            "AI Priority",
            "AI Scope",
        ):
            if required not in headers:
                errors.append(f"Missing required column: {required}")

    if "Audit Log" in wb.sheetnames:
        aws = wb["Audit Log"]
        audit_headers = [aws.cell(1, c).value for c in range(1, len(AUDIT_COLUMNS) + 1)]
        if audit_headers != AUDIT_COLUMNS:
            errors.append(f"Audit Log headers mismatch: {audit_headers}")
        if "AuditLog" not in (getattr(aws, "tables", {}) or {}):
            errors.append("Missing Excel table AuditLog")

    # Named ranges required for dropdowns / SLA
    defined = {name for name in wb.defined_names}
    for name in (
        "SLA_High",
        "SLA_Medium",
        "SLA_Low",
        "List_Status",
        "List_Priority",
        "List_Categories",
        "List_ProcessingStage",
        "List_AckSent",
        "List_AIPriority",
    ):
        if name not in defined:
            errors.append(f"Missing defined name: {name}")

    # Dashboard / Reports must not contain #REF!
    for sheet_name in ("Dashboard", "Reports"):
        if sheet_name not in wb.sheetnames:
            continue
        sw = wb[sheet_name]
        for row in sw.iter_rows(max_row=40, max_col=10):
            for cell in row:
                if isinstance(cell.value, str) and "#REF!" in cell.value:
                    errors.append(f"{sheet_name}!{cell.coordinate} contains #REF!")

    # Spot-check Dashboard Status/Priority/Age letters match current schema
    if "Dashboard" in wb.sheetnames:
        dash = wb["Dashboard"]
        status_l = col_letter("Status")
        age_l = col_letter("Ticket Age Days")
        found_status = False
        found_age = False
        for row in dash.iter_rows(min_row=3, max_row=20, max_col=2):
            for cell in row:
                if isinstance(cell.value, str):
                    if f"Tickets!${status_l}$" in cell.value:
                        found_status = True
                    if f"Tickets!${age_l}$" in cell.value:
                        found_age = True
        if not found_status:
            errors.append(f"Dashboard formulas missing Status column ${status_l}$")
        if not found_age:
            errors.append(f"Dashboard formulas missing Age column ${age_l}$")

    wb.close()
    return errors


def generate(output: Path) -> Path:
    wb = Workbook()
    default = wb.active
    wb.remove(default)

    # Build order matters: Configuration names → lists → Tickets table → dashboards
    build_configuration(wb)
    build_categories(wb)
    build_users(wb)
    build_tickets(wb)
    build_audit_log(wb)
    build_dashboard(wb)
    build_reports(wb)

    order = ["Dashboard", "Tickets", "Configuration", "Categories", "Users", "Audit Log", "Reports"]
    for idx, name in enumerate(order):
        wb.move_sheet(name, offset=idx - wb.sheetnames.index(name))

    output.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output)
    _fix_chart_category_refs(output)

    errors = verify_workbook(output)
    if errors:
        print("Workbook verification FAILED:")
        for err in errors:
            print(f"  - {err}")
        raise SystemExit(1)
    print("Workbook verification PASS")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate IT Support Tickets workbook")
    default_out = Path(__file__).resolve().parent.parent / "assets" / "IT Support Tickets.xlsx"
    parser.add_argument(
        "--output",
        type=Path,
        default=default_out,
        help="Output .xlsx path",
    )
    args = parser.parse_args()
    path = generate(args.output)
    print(f"Workbook written: {path}")


if __name__ == "__main__":
    main()
