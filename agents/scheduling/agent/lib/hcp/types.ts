/**
 * The HousecallPro shapes the scheduling tools consume. These are PROJECTIONS,
 * not HCP's records: the MCP query (or the fixture) already dropped customer
 * phones, emails, street addresses and notes. What is not here never enters
 * model context. See plan §5 ("every read tool projects its output").
 */

export interface HcpJob {
  id: string;
  invoice: string | null;
  description: string | null;
  /** HCP's reported vocabulary: "needs scheduling" | "scheduled" | "in progress" | "complete rated" | … */
  status: string;
  start: string | null; // ISO, UTC
  end: string | null;
  arrival: number | null; // minutes
  total: number; // cents
  tags: string[];
  employees: string[]; // first names as HCP reports them
  employee_ids: string[];
  job_type: string | null;
  customer: { first: string | null; last: string | null };
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface HcpEvent {
  id: string;
  name: string;
  recurrence_rule: string | null;
  start: string; // ISO, UTC
  end: string | null;
  all_day: boolean;
  employees: string[]; // assigned first names
}

export interface HcpLineItem {
  id: string;
  name: string;
  kind: string | null;
  amount: number; // cents
}

export interface HcpEmployee {
  id: string;
  first_name: string;
  last_name: string | null;
  role: string | null;
}

export interface JobsFilter {
  work_status?: Array<"unscheduled" | "scheduled" | "in_progress" | "completed" | "canceled">;
  scheduled_start_min?: string; // YYYY-MM-DD (inclusive, whole day) or ISO
  scheduled_start_max?: string;
}

export interface HcpSource {
  /** All matching jobs, every page. */
  jobs(filter: JobsFilter): Promise<HcpJob[]>;
  /** Every calendar event, every page — the endpoint has no date filter. */
  events(): Promise<HcpEvent[]>;
  lineItems(jobId: string): Promise<HcpLineItem[]>;
  employees(): Promise<HcpEmployee[]>;
  /** Open-Meteo daily precipitation (inches) for past + forecast days. */
  precipitation(point: { latitude: number; longitude: number }, pastDays: number, forecastDays: number): Promise<Array<{ date: string; inches: number }>>;
}
