# Tripletex MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for the [Tripletex](https://tripletex.no) accounting API. Enables AI assistants to log hours, manage timesheets, and handle invoices through natural language.

## Features

- **Time tracking** — log hours, start/stop timers, search entries
- **Projects & activities** — look up projects and activities by name
- **Timesheet approval** — complete, approve, and reopen weekly/monthly timesheets
- **Invoices** — search outgoing and incoming invoices
- **Supplier invoice approval** — approve or reject supplier invoices

## Setup

### 1. Get your Tripletex API tokens

You need two tokens from Tripletex:

- **Consumer token** — provided after [API 2.0 registration](https://developer.tripletex.no/)
- **Employee token** — created by an admin in Tripletex under user settings > "API access"

The server automatically creates a session token on first use (valid 1 day).

### 2. Install

```bash
git clone https://github.com/your-org/tripletex-mcp.git
cd tripletex-mcp
npm install
npm run build
```

### 3. Configure your MCP client

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tripletex": {
      "command": "node",
      "args": ["/path/to/tripletex-mcp/dist/index.js"],
      "env": {
        "TRIPLETEX_CONSUMER_TOKEN": "<your-consumer-token>",
        "TRIPLETEX_EMPLOYEE_TOKEN": "<your-employee-token>"
      }
    }
  }
}
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `TRIPLETEX_CONSUMER_TOKEN` | Yes | API consumer token |
| `TRIPLETEX_EMPLOYEE_TOKEN` | Yes | Employee token |
| `TRIPLETEX_COMPANY_ID` | No | Company ID (default: `0` = own company) |
| `TRIPLETEX_API_URL` | No | API base URL (default: `https://tripletex.no/v2`) |

## Tools

### Authentication
- `whoami` — Get information about the currently authenticated user

### Projects & Activities
- `search_projects` — Search for projects by name or other filters
- `search_activities` — Search for activities (e.g. development, meetings, vacation)

### Time Tracking
- `search_timesheet_entries` — Search timesheet entries for a date range
- `get_timesheet_entry` — Get a single timesheet entry by ID
- `create_timesheet_entry` — Log hours for a project/activity/date
- `update_timesheet_entry` — Update an existing timesheet entry
- `delete_timesheet_entry` — Delete a timesheet entry
- `get_total_hours` — Get total hours for a date range
- `get_recent_projects` — Get recently used projects
- `get_recent_activities` — Get recently used activities for a project

### Time Clock
- `start_time_clock` — Start a real-time timer
- `stop_time_clock` — Stop a running timer
- `get_current_time_clock` — Get the currently running timer

### Timesheet Approval
- `search_timesheet_weeks` — Search weekly timesheet status
- `approve_timesheet_week` — Approve a timesheet week
- `complete_timesheet_week` — Mark a week as complete
- `reopen_timesheet_week` — Reopen a completed/approved week
- `get_timesheet_month` — Get monthly timesheet status
- `approve_timesheet_month` — Approve a timesheet month
- `complete_timesheet_month` — Mark a month as complete
- `reopen_timesheet_month` — Reopen a completed/approved month

### Invoices
- `search_invoices` — Search outgoing (customer) invoices
- `get_invoice` — Get a single outgoing invoice by ID
- `search_supplier_invoices` — Search incoming (supplier) invoices
- `get_supplier_invoice` — Get a single supplier invoice by ID
- `get_supplier_invoices_for_approval` — Get invoices pending approval
- `approve_supplier_invoice` — Approve a supplier invoice
- `approve_supplier_invoices` — Approve multiple supplier invoices
- `reject_supplier_invoice` — Reject a supplier invoice (comment required)
- `reject_supplier_invoices` — Reject multiple supplier invoices (comment required)

## Development

```bash
npm install
npm run build
```

## License

ISC
