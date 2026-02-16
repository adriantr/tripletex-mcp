#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// --- Configuration ---

const BASE_URL =
  process.env.TRIPLETEX_API_URL || "https://tripletex.no/v2";

const consumerToken = process.env.TRIPLETEX_CONSUMER_TOKEN;
const employeeToken = process.env.TRIPLETEX_EMPLOYEE_TOKEN;
const companyId = process.env.TRIPLETEX_COMPANY_ID || "0";

let sessionToken: string | null = null;

// --- Session management ---

async function createSessionToken(): Promise<string> {
  if (!consumerToken || !employeeToken) {
    throw new Error(
      "TRIPLETEX_CONSUMER_TOKEN and TRIPLETEX_EMPLOYEE_TOKEN env vars are required."
    );
  }

  // Session token valid for 1 day
  const expiration = new Date();
  expiration.setDate(expiration.getDate() + 1);
  const expirationDate = expiration.toISOString().split("T")[0];

  const url = new URL(`${BASE_URL}/token/session/:create`);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consumerToken, employeeToken, expirationDate }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to create session token: ${res.status} ${text}`);
  }

  const result = JSON.parse(text) as { value: { token: string } };
  return result.value.token;
}

async function ensureSession(): Promise<void> {
  if (!sessionToken) {
    sessionToken = await createSessionToken();
  }
}

// --- HTTP helpers ---

function authHeader(): Record<string, string> {
  if (!sessionToken) {
    throw new Error("No session token available.");
  }
  const encoded = Buffer.from(`${companyId}:${sessionToken}`).toString(
    "base64"
  );
  return { Authorization: `Basic ${encoded}` };
}

async function apiRequest(
  method: string,
  path: string,
  opts?: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  }
): Promise<unknown> {
  await ensureSession();

  const url = new URL(`${BASE_URL}${path}`);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeader(),
  };

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Tripletex API ${res.status}: ${text}`);
  }
  if (!text) return {};
  return JSON.parse(text);
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

// --- MCP Server ---

const server = new McpServer({
  name: "tripletex",
  version: "1.0.0",
});

// =====================
// AUTHENTICATION
// =====================

server.registerTool("whoami", {
  description: "Get information about the currently authenticated user.",
}, async () => {
  const result = await apiRequest("GET", "/token/session/>whoAmI");
  return jsonResult(result);
});

// =====================
// PROJECTS & ACTIVITIES
// =====================

server.registerTool("search_projects", {
  description: "Search for projects by name or other filters. Use this to find project IDs for logging hours.",
  inputSchema: {
    name: z.string().optional().describe("Search by project name (partial match)"),
    number: z.string().optional().describe("Search by project number (exact match)"),
    employeeInProjectId: z.string().optional().describe("Filter by employee ID(s) assigned to project"),
    projectManagerId: z.string().optional().describe("Filter by project manager ID(s)"),
    isClosed: z.boolean().optional().describe("Filter by closed status"),
    from: z.number().optional().describe("Pagination offset"),
    count: z.number().optional().describe("Number of results"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/project", { query: params });
  return jsonResult(result);
});

server.registerTool("search_activities", {
  description: "Search for activities (e.g. development, meetings, vacation). Use this to find activity IDs for logging hours.",
  inputSchema: {
    name: z.string().optional().describe("Search by activity name (partial match)"),
    number: z.string().optional().describe("Search by activity number (exact match)"),
    isProjectActivity: z.boolean().optional().describe("Filter to project activities only"),
    isGeneral: z.boolean().optional().describe("Filter to general activities only"),
    isInactive: z.boolean().optional().describe("Filter by inactive status (default: show active)"),
    from: z.number().optional().describe("Pagination offset"),
    count: z.number().optional().describe("Number of results"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/activity", { query: params });
  return jsonResult(result);
});

// =====================
// TIMESHEET ENTRIES
// =====================

server.registerTool("search_timesheet_entries", {
  description: "Search timesheet entries for a date range. Returns hours logged by employees.",
  inputSchema: {
    dateFrom: z.string().describe("From date inclusive (yyyy-MM-dd)"),
    dateTo: z.string().describe("To date exclusive (yyyy-MM-dd)"),
    employeeId: z.string().optional().describe("Filter by employee ID(s), comma-separated"),
    projectId: z.string().optional().describe("Filter by project ID(s), comma-separated"),
    activityId: z.string().optional().describe("Filter by activity ID(s), comma-separated"),
    comment: z.string().optional().describe("Filter by comment text"),
    from: z.number().optional().describe("Pagination offset (default 0)"),
    count: z.number().optional().describe("Number of results (default 1000)"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/timesheet/entry", { query: params });
  return jsonResult(result);
});

server.registerTool("get_timesheet_entry", {
  description: "Get a single timesheet entry by ID.",
  inputSchema: {
    id: z.number().describe("Timesheet entry ID"),
  },
}, async ({ id }) => {
  const result = await apiRequest("GET", `/timesheet/entry/${id}`);
  return jsonResult(result);
});

server.registerTool("create_timesheet_entry", {
  description: "Create a new timesheet entry (log hours). Only one entry per employee/date/activity/project combo.",
  inputSchema: {
    employeeId: z.number().describe("Employee ID"),
    projectId: z.number().describe("Project ID"),
    activityId: z.number().describe("Activity ID"),
    date: z.string().describe("Date (yyyy-MM-dd)"),
    hours: z.number().describe("Number of hours"),
    comment: z.string().optional().describe("Optional comment"),
  },
}, async (params) => {
  const result = await apiRequest("POST", "/timesheet/entry", {
    body: {
      employee: { id: params.employeeId },
      project: { id: params.projectId },
      activity: { id: params.activityId },
      date: params.date,
      hours: params.hours,
      comment: params.comment,
    },
  });
  return jsonResult(result);
});

server.registerTool("update_timesheet_entry", {
  description: "Update an existing timesheet entry. Fields not set will be nulled.",
  inputSchema: {
    id: z.number().describe("Timesheet entry ID"),
    version: z.number().describe("Current version number (for optimistic locking)"),
    employeeId: z.number().describe("Employee ID"),
    projectId: z.number().describe("Project ID"),
    activityId: z.number().describe("Activity ID"),
    date: z.string().describe("Date (yyyy-MM-dd)"),
    hours: z.number().describe("Number of hours"),
    comment: z.string().optional().describe("Optional comment"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", `/timesheet/entry/${params.id}`, {
    body: {
      id: params.id,
      version: params.version,
      employee: { id: params.employeeId },
      project: { id: params.projectId },
      activity: { id: params.activityId },
      date: params.date,
      hours: params.hours,
      comment: params.comment,
    },
  });
  return jsonResult(result);
});

server.registerTool("delete_timesheet_entry", {
  description: "Delete a timesheet entry.",
  annotations: { destructiveHint: true },
  inputSchema: {
    id: z.number().describe("Timesheet entry ID"),
    version: z.number().optional().describe("Version number for optimistic locking"),
  },
}, async ({ id, version }) => {
  await apiRequest("DELETE", `/timesheet/entry/${id}`, { query: { version } });
  return { content: [{ type: "text" as const, text: `Timesheet entry ${id} deleted.` }] };
});

server.registerTool("get_total_hours", {
  description: "Get total hours registered for an employee in a date range.",
  inputSchema: {
    employeeId: z.number().optional().describe("Employee ID (defaults to token owner)"),
    startDate: z.string().optional().describe("Start date (yyyy-MM-dd, defaults to today)"),
    endDate: z.string().optional().describe("End date (yyyy-MM-dd, defaults to tomorrow)"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/timesheet/entry/>totalHours", { query: params });
  return jsonResult(result);
});

server.registerTool("get_recent_projects", {
  description: "Get recently used projects for timesheet entries.",
  inputSchema: {
    employeeId: z.number().optional().describe("Employee ID (defaults to token owner)"),
  },
}, async ({ employeeId }) => {
  const result = await apiRequest("GET", "/timesheet/entry/>recentProjects", { query: { employeeId } });
  return jsonResult(result);
});

server.registerTool("get_recent_activities", {
  description: "Get recently used activities for a project.",
  inputSchema: {
    projectId: z.number().describe("Project ID"),
    employeeId: z.number().optional().describe("Employee ID (defaults to token owner)"),
  },
}, async ({ projectId, employeeId }) => {
  const result = await apiRequest("GET", "/timesheet/entry/>recentActivities", { query: { projectId, employeeId } });
  return jsonResult(result);
});

// =====================
// TIME CLOCK
// =====================

server.registerTool("start_time_clock", {
  description: "Start a time clock (timer) for tracking hours in real-time.",
  inputSchema: {
    activityId: z.number().describe("Activity ID"),
    projectId: z.number().optional().describe("Project ID"),
    employeeId: z.number().optional().describe("Employee ID (defaults to token owner)"),
    date: z.string().optional().describe("Date (defaults to today)"),
    comment: z.string().optional().describe("Optional comment"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/timeClock/:start", { query: params });
  return jsonResult(result);
});

server.registerTool("stop_time_clock", {
  description: "Stop a running time clock.",
  inputSchema: {
    id: z.number().describe("Time clock ID"),
    comment: z.string().optional().describe("Optional comment"),
  },
}, async ({ id, comment }) => {
  const result = await apiRequest("PUT", `/timesheet/timeClock/${id}/:stop`, { query: { comment } });
  return jsonResult(result);
});

server.registerTool("get_current_time_clock", {
  description: "Get the currently running time clock for an employee.",
  inputSchema: {
    employeeId: z.number().optional().describe("Employee ID (defaults to token owner)"),
  },
}, async ({ employeeId }) => {
  const result = await apiRequest("GET", "/timesheet/timeClock/present", { query: { employeeId } });
  return jsonResult(result);
});

// =====================
// TIMESHEET WEEK
// =====================

server.registerTool("search_timesheet_weeks", {
  description: "Search weekly timesheet status.",
  inputSchema: {
    employeeIds: z.string().optional().describe("Employee ID(s), comma-separated"),
    weekYear: z.string().optional().describe("ISO week-year (e.g. '2026-07')"),
    from: z.number().optional().describe("Pagination offset"),
    count: z.number().optional().describe("Number of results"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/timesheet/week", { query: params });
  return jsonResult(result);
});

server.registerTool("approve_timesheet_week", {
  description: "Approve a timesheet week.",
  inputSchema: {
    id: z.number().optional().describe("Timesheet week ID"),
    employeeId: z.number().optional().describe("Employee ID"),
    weekYear: z.string().optional().describe("ISO week-year (e.g. '2026-07')"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/week/:approve", { query: params });
  return jsonResult(result);
});

server.registerTool("complete_timesheet_week", {
  description: "Mark a timesheet week as complete.",
  inputSchema: {
    id: z.number().optional().describe("Timesheet week ID"),
    employeeId: z.number().optional().describe("Employee ID"),
    weekYear: z.string().optional().describe("ISO week-year (e.g. '2026-07')"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/week/:complete", { query: params });
  return jsonResult(result);
});

server.registerTool("reopen_timesheet_week", {
  description: "Reopen a completed/approved timesheet week.",
  inputSchema: {
    id: z.number().optional().describe("Timesheet week ID"),
    employeeId: z.number().optional().describe("Employee ID"),
    weekYear: z.string().optional().describe("ISO week-year (e.g. '2026-07')"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/week/:reopen", { query: params });
  return jsonResult(result);
});

// =====================
// TIMESHEET MONTH
// =====================

server.registerTool("get_timesheet_month", {
  description: "Get monthly timesheet status for employees.",
  inputSchema: {
    employeeIds: z.string().describe("Employee ID(s), comma-separated"),
    monthYear: z.string().describe("Month (e.g. '2026-02')"),
  },
}, async ({ employeeIds, monthYear }) => {
  const result = await apiRequest("GET", "/timesheet/month/byMonthNumberList", {
    query: { employeeIds, monthYearList: monthYear },
  });
  return jsonResult(result);
});

server.registerTool("approve_timesheet_month", {
  description: "Approve a timesheet month.",
  inputSchema: {
    id: z.number().optional().describe("Timesheet month ID"),
    employeeIds: z.string().optional().describe("Employee ID(s), comma-separated"),
    monthYear: z.string().optional().describe("Month (e.g. '2026-02')"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/month/:approve", { query: params });
  return jsonResult(result);
});

server.registerTool("complete_timesheet_month", {
  description: "Mark a timesheet month as complete.",
  inputSchema: {
    id: z.number().optional().describe("Timesheet month ID"),
    employeeIds: z.string().optional().describe("Employee ID(s), comma-separated"),
    monthYear: z.string().optional().describe("Month (e.g. '2026-02')"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/month/:complete", { query: params });
  return jsonResult(result);
});

server.registerTool("reopen_timesheet_month", {
  description: "Reopen a completed/approved timesheet month.",
  inputSchema: {
    id: z.number().optional().describe("Timesheet month ID"),
    employeeIds: z.string().optional().describe("Employee ID(s), comma-separated"),
    monthYear: z.string().optional().describe("Month (e.g. '2026-02')"),
  },
}, async (params) => {
  const result = await apiRequest("PUT", "/timesheet/month/:reopen", { query: params });
  return jsonResult(result);
});

// =====================
// INVOICES (outgoing)
// =====================

server.registerTool("search_invoices", {
  description: "Search outgoing (customer) invoices by date range.",
  inputSchema: {
    invoiceDateFrom: z.string().describe("From date inclusive (yyyy-MM-dd)"),
    invoiceDateTo: z.string().describe("To date exclusive (yyyy-MM-dd)"),
    invoiceNumber: z.string().optional().describe("Filter by invoice number"),
    customerId: z.string().optional().describe("Filter by customer ID"),
    from: z.number().optional().describe("Pagination offset"),
    count: z.number().optional().describe("Number of results"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/invoice", { query: params });
  return jsonResult(result);
});

server.registerTool("get_invoice", {
  description: "Get a single outgoing invoice by ID.",
  inputSchema: {
    id: z.number().describe("Invoice ID"),
  },
}, async ({ id }) => {
  const result = await apiRequest("GET", `/invoice/${id}`);
  return jsonResult(result);
});

// =====================
// SUPPLIER INVOICES (incoming - with approve/reject)
// =====================

server.registerTool("search_supplier_invoices", {
  description: "Search incoming (supplier) invoices by date range.",
  inputSchema: {
    invoiceDateFrom: z.string().describe("From date inclusive (yyyy-MM-dd)"),
    invoiceDateTo: z.string().describe("To date exclusive (yyyy-MM-dd)"),
    invoiceNumber: z.string().optional().describe("Filter by invoice number"),
    supplierId: z.string().optional().describe("Filter by supplier ID"),
    from: z.number().optional().describe("Pagination offset"),
    count: z.number().optional().describe("Number of results"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/supplierInvoice", { query: params });
  return jsonResult(result);
});

server.registerTool("get_supplier_invoice", {
  description: "Get a single supplier invoice by ID.",
  inputSchema: {
    id: z.number().describe("Supplier invoice ID"),
  },
}, async ({ id }) => {
  const result = await apiRequest("GET", `/supplierInvoice/${id}`);
  return jsonResult(result);
});

server.registerTool("get_supplier_invoices_for_approval", {
  description: "Get supplier invoices that are pending approval.",
  inputSchema: {
    searchText: z.string().optional().describe("Search text (department, employee, project)"),
    showAll: z.boolean().optional().describe("Show all invoices, not just own (default false)"),
    employeeId: z.number().optional().describe("Employee ID (defaults to logged in)"),
    from: z.number().optional().describe("Pagination offset"),
    count: z.number().optional().describe("Number of results"),
  },
}, async (params) => {
  const result = await apiRequest("GET", "/supplierInvoice/forApproval", { query: params });
  return jsonResult(result);
});

server.registerTool("approve_supplier_invoice", {
  description: "Approve a supplier invoice.",
  inputSchema: {
    invoiceId: z.number().describe("Supplier invoice ID to approve"),
    comment: z.string().optional().describe("Optional approval comment"),
  },
}, async ({ invoiceId, comment }) => {
  const result = await apiRequest("PUT", `/supplierInvoice/${invoiceId}/:approve`, { query: { comment } });
  return jsonResult(result);
});

server.registerTool("approve_supplier_invoices", {
  description: "Approve multiple supplier invoices at once.",
  inputSchema: {
    invoiceIds: z.string().describe("Comma-separated invoice IDs"),
    comment: z.string().optional().describe("Optional approval comment"),
  },
}, async ({ invoiceIds, comment }) => {
  const result = await apiRequest("PUT", "/supplierInvoice/:approve", { query: { invoiceIds, comment } });
  return jsonResult(result);
});

server.registerTool("reject_supplier_invoice", {
  description: "Reject a supplier invoice. A comment is required.",
  annotations: { destructiveHint: true },
  inputSchema: {
    invoiceId: z.number().describe("Supplier invoice ID to reject"),
    comment: z.string().describe("Rejection reason (required)"),
  },
}, async ({ invoiceId, comment }) => {
  const result = await apiRequest("PUT", `/supplierInvoice/${invoiceId}/:reject`, { query: { comment } });
  return jsonResult(result);
});

server.registerTool("reject_supplier_invoices", {
  description: "Reject multiple supplier invoices at once. A comment is required.",
  annotations: { destructiveHint: true },
  inputSchema: {
    invoiceIds: z.string().describe("Comma-separated invoice IDs"),
    comment: z.string().describe("Rejection reason (required)"),
  },
}, async ({ invoiceIds, comment }) => {
  const result = await apiRequest("PUT", "/supplierInvoice/:reject", { query: { invoiceIds, comment } });
  return jsonResult(result);
});

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
