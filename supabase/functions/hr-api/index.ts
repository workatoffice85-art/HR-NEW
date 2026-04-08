
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.5";

type JsonRec = Record<string, unknown>;

type SiteMatch = { id: string; name: string; transportPrice: number };
type TransportCtx = {
  siteMap: Record<string, number>;
  employeeMap: Record<string, number>;
  requestMap: Record<string, number>;
};

const FACE_THRESHOLD = 0.6;
const AUTO_WAIT_MS = 2 * 60 * 1000;
const AUTO_MAX_METERS = 700;
const AUTO_META = "auto_2min_700m";
const APP_TIMEZONE = Deno.env.get("APP_TIMEZONE") ?? "Africa/Cairo";
const OTP_DEBUG = (Deno.env.get("OTP_DEBUG_MODE") ?? "true").toLowerCase() === "true";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ok = (payload: JsonRec, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error:\s*/i, "") : String(e || "Unknown error"));

const ARABIC_INDIC = /[\u0660-\u0669]/g;
const EASTERN_ARABIC_INDIC = /[\u06F0-\u06F9]/g;

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const t = String(v)
    .replace(/[\u200f\u200e\s]/g, "")
    .replace(ARABIC_INDIC, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_INDIC, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[\u066C,\u060C]/g, "")
    .replace(/\u066B/g, ".")
    .replace(/[^\d.-]/g, "");
  const p = Number.parseFloat(t);
  return Number.isFinite(p) ? p : fallback;
}

const emailNorm = (v: unknown) => String(v || "").trim().toLowerCase();

function phoneNorm(v: unknown): string {
  let p = String(v || "").trim();
  if (!p) return "";
  p = p
    .replace(ARABIC_INDIC, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC_INDIC, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[\u200f\u200e\s-]/g, "")
    .replace(/[()]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  p = p.startsWith("+") ? `+${p.slice(1).replace(/[^\d]/g, "")}` : p.replace(/[^\d]/g, "");
  if (/^01\d{9}$/.test(p)) p = `+2${p}`;
  else if (/^20\d{10}$/.test(p)) p = `+${p}`;
  return p;
}

function dateKey(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return y && m && day ? `${y}-${m}-${day}` : "";
}

function dayHourMinute(d: Date): { day: number; hour: number; minute: number } {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, weekday: "short" }).format(d);
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const t = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  return {
    day: wdMap[wd] ?? d.getDay(),
    hour: Number.parseInt(t.find((p) => p.type === "hour")?.value || "0", 10),
    minute: Number.parseInt(t.find((p) => p.type === "minute")?.value || "0", 10),
  };
}

function hhmm(v: unknown, fallback = "09:00"): string {
  if (v === null || v === undefined || v === "") return fallback;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!m) return fallback;
  const h = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const latLngOk = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function meters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371e3;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const df = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function faceDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== 128 || b.length !== 128) return 1;
  let sum = 0;
  for (let i = 0; i < 128; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function parseDescriptor(v: unknown): number[] | null {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) {
    const out = v.map((x) => Number(x));
    return out.length === 128 && out.every((n) => Number.isFinite(n)) ? out : null;
  }
  if (typeof v === "string") {
    try {
      return parseDescriptor(JSON.parse(v));
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    return parseDescriptor((v as { data?: unknown }).data);
  }
  return null;
}

const descriptorText = (v: unknown) => (typeof v === "string" ? v : v ? JSON.stringify(v) : "");
const splitSites = (v: unknown) => (Array.isArray(v) ? v : String(v || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
const isReqSite = (id: unknown) => /^REQ/i.test(String(id || ""));

function resolveTransport(raw: unknown, employeeId: unknown, siteId: unknown, ctx: TransportCtx): number {
  const sid = String(siteId || "");
  const eid = String(employeeId || "");
  if (isReqSite(sid)) {
    const rt = num(ctx.requestMap[sid], Number.NaN);
    if (Number.isFinite(rt)) return rt;
  }
  const et = num(ctx.employeeMap[eid], Number.NaN);
  if (Number.isFinite(et)) return et;
  const at = num(raw, Number.NaN);
  if (Number.isFinite(at)) return at;
  const st = num(ctx.siteMap[sid], Number.NaN);
  return Number.isFinite(st) ? st : 0;
}

function extractLatLng(text: string): { lat: number; lng: number } | null {
  const raw = String(text || "");
  if (!raw) return null;
  const candidates = [raw];
  try {
    const d = decodeURIComponent(raw);
    if (d !== raw) candidates.push(d);
  } catch {
    // ignore
  }
  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&]q=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
    /[?&]query=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
    /center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];
  for (const c of candidates) {
    for (const p of patterns) {
      const m = c.match(p);
      if (!m) continue;
      const lat = Number.parseFloat(m[1]);
      const lng = Number.parseFloat(m[2]);
      if (latLngOk(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

async function resolveMapLink(link: unknown): Promise<JsonRec> {
  const url = String(link || "").trim();
  if (!url) return { success: false, message: "Map link is required." };
  try {
    let finalUrl = url;
    let html = "";
    try {
      const r = await fetch(url, { method: "GET", redirect: "follow" });
      finalUrl = r.url || url;
      html = await r.text();
    } catch {
      // ignore network failures
    }
    const hit = extractLatLng(finalUrl) || (html ? extractLatLng(html) : null);
    return { success: true, url: finalUrl, lat: hit?.lat ?? null, lng: hit?.lng ?? null };
  } catch (e) {
    return { success: false, message: `Failed to parse map link: ${errText(e)}` };
  }
}

async function validateMapLink(link: unknown, refLat: unknown, refLng: unknown, maxMeters: number): Promise<JsonRec> {
  const rLat = num(refLat, Number.NaN);
  const rLng = num(refLng, Number.NaN);
  if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) return { success: false, message: "Invalid reference coordinates." };
  const resolved = await resolveMapLink(link);
  if (!resolved.success) return resolved;
  const mLat = num(resolved.lat, Number.NaN);
  const mLng = num(resolved.lng, Number.NaN);
  if (!Number.isFinite(mLat) || !Number.isFinite(mLng)) return { success: false, message: "Could not extract map coordinates." };
  const d = meters(rLat, rLng, mLat, mLng);
  if (d > maxMeters) return { success: false, message: `Map link is too far (${d.toFixed(0)}m).` };
  return { success: true, url: resolved.url, lat: mLat, lng: mLng, distance: d };
}

const activeToday = (r: { status: string; approved_at: string | null; timestamp: string }) =>
  r.status === "approved_today" && dateKey(r.approved_at || r.timestamp) === dateKey(new Date());
function requestId() {
  return `REQ${Math.floor(10000 + Math.random() * 90000)}`;
}

function siteId() {
  return String(10000 + Math.floor(Math.random() * 90000));
}

async function getSettings(): Promise<Record<string, string>> {
  const { data, error } = await db.from("settings").select("key, value");
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of data || []) out[row.key] = String(row.value || "");
  if (!out.workStartTime) out.workStartTime = "09:00";
  if (!out.workEndTime) out.workEndTime = "17:00";
  return out;
}

async function transportCtx(): Promise<TransportCtx> {
  const [s, e, r] = await Promise.all([
    db.from("sites").select("id, transport_price"),
    db.from("employees").select("id, transport_price"),
    db.from("site_requests").select("id, transport_price"),
  ]);
  if (s.error) throw s.error;
  if (e.error) throw e.error;
  if (r.error) throw r.error;

  const siteMap: Record<string, number> = {};
  for (const row of s.data || []) siteMap[String(row.id)] = num(row.transport_price, 0);

  const employeeMap: Record<string, number> = {};
  for (const row of e.data || []) employeeMap[String(row.id)] = num(row.transport_price, 0);

  const requestMap: Record<string, number> = {};
  for (const row of r.data || []) requestMap[String(row.id)] = num(row.transport_price, 0);

  return { siteMap, employeeMap, requestMap };
}

async function assertUniqueContacts(email: string, phone: string, ignoreId?: string): Promise<void> {
  const { data, error } = await db.from("employees").select("id, email, phone");
  if (error) throw error;

  const ne = emailNorm(email);
  const np = phoneNorm(phone);
  if (!ne) throw new Error("Email is required");
  if (!np) throw new Error("Phone is required");

  for (const row of data || []) {
    const rid = String(row.id || "");
    if (ignoreId && rid === ignoreId) continue;
    if (emailNorm(row.email) === ne) throw new Error("Email already registered");
    if (phoneNorm(row.phone) === np) throw new Error("Phone already registered");
  }
}

async function validateAll(payload: JsonRec): Promise<SiteMatch> {
  const employeeId = String(payload.employeeId || "");
  if (!employeeId) throw new Error("Employee ID is required");

  const { data: user, error: userError } = await db
    .from("employees")
    .select("id, face_descriptor")
    .eq("id", employeeId)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) throw new Error("Employee not found");

  const saved = parseDescriptor(user.face_descriptor);
  const incoming = parseDescriptor(payload.faceDescriptor);
  if (saved && incoming) {
    if (faceDistance(saved, incoming) > FACE_THRESHOLD) throw new Error("Face descriptor does not match");
  } else if (saved && !incoming) {
    throw new Error("Face verification is required");
  }

  const lat = num(payload.latitude, Number.NaN);
  const lng = num(payload.longitude, Number.NaN);
  if (!latLngOk(lat, lng)) throw new Error("Valid GPS coordinates are required");

  const { data: sites, error: sitesError } = await db
    .from("sites")
    .select("id, name, latitude, longitude, radius, transport_price");
  if (sitesError) throw sitesError;

  for (const s of sites || []) {
    const d = meters(lat, lng, num(s.latitude, Number.NaN), num(s.longitude, Number.NaN));
    if (d <= num(s.radius, 20)) {
      return { id: String(s.id), name: String(s.name || "Unknown Site"), transportPrice: num(s.transport_price, 0) };
    }
  }

  const { data: requests, error: reqError } = await db
    .from("site_requests")
    .select(
      "id, employee_id, suggested_name, latitude, longitude, status, timestamp, transport_price, " +
        "temp_radius, approved_at, map_link, map_latitude, map_longitude, note",
    )
    .eq("employee_id", employeeId)
    .order("timestamp", { ascending: false });
  if (reqError) throw reqError;

  for (const r of requests || []) {
    if (!activeToday(r)) continue;
    const d = meters(lat, lng, num(r.latitude, Number.NaN), num(r.longitude, Number.NaN));
    if (d <= num(r.temp_radius, 100)) {
      return { id: String(r.id), name: String(r.suggested_name || "Temporary Site"), transportPrice: num(r.transport_price, 0) };
    }
  }

  const now = new Date();
  for (const r of requests || []) {
    if (String(r.status || "") !== "pending") continue;
    const createdAt = new Date(String(r.timestamp || ""));
    if (Number.isNaN(createdAt.getTime())) continue;
    if (now.getTime() - createdAt.getTime() < AUTO_WAIT_MS) continue;

    const reqLat = num(r.latitude, Number.NaN);
    const reqLng = num(r.longitude, Number.NaN);
    if (!latLngOk(reqLat, reqLng)) continue;
    if (meters(lat, lng, reqLat, reqLng) > AUTO_MAX_METERS) continue;

    const mapLink = String(r.map_link || "").trim();
    if (!mapLink) continue;

    let mapLat = num(r.map_latitude, Number.NaN);
    let mapLng = num(r.map_longitude, Number.NaN);

    if (!latLngOk(mapLat, mapLng)) {
      const v = await validateMapLink(mapLink, reqLat, reqLng, AUTO_MAX_METERS);
      if (!v.success) continue;
      mapLat = num(v.lat, Number.NaN);
      mapLng = num(v.lng, Number.NaN);
    } else if (meters(reqLat, reqLng, mapLat, mapLng) > AUTO_MAX_METERS) {
      continue;
    }

    const curNote = String(r.note || "").trim();
    const nextNote = curNote ? `${curNote} | [AUTO APPROVED after 2 minutes, within 700m]` : "[AUTO APPROVED after 2 minutes, within 700m]";

    const { error: updateError } = await db
      .from("site_requests")
      .update({
        status: "approved_today",
        temp_radius: AUTO_MAX_METERS,
        approved_at: now.toISOString(),
        note: nextNote,
        auto_meta: AUTO_META,
        map_latitude: mapLat,
        map_longitude: mapLng,
      })
      .eq("id", r.id);
    if (updateError) throw updateError;

    return { id: String(r.id), name: String(r.suggested_name || "Temporary Site"), transportPrice: num(r.transport_price, 120) };
  }

  throw new Error("You are outside all approved site ranges.");
}

async function deleteTempAttendanceForRequestDay(row: {
  id: string;
  employee_id: string;
  approved_at: string | null;
  timestamp: string;
}): Promise<number> {
  const targetDay = dateKey(row.approved_at || row.timestamp);
  if (!targetDay) return 0;

  const { data, error } = await db
    .from("attendance")
    .select("id, check_in")
    .eq("employee_id", row.employee_id)
    .eq("site_id", row.id);
  if (error) throw error;

  const ids = (data || []).filter((x) => dateKey(x.check_in) === targetDay).map((x) => x.id);
  if (!ids.length) return 0;

  const { error: delError } = await db.from("attendance").delete().in("id", ids);
  if (delError) throw delError;
  return ids.length;
}
async function getEmployeesAction(): Promise<JsonRec> {
  const { data, error } = await db
    .from("employees")
    .select("id, name, email, phone, role, assigned_sites, face_descriptor, transport_price")
    .order("created_at", { ascending: true });
  if (error) throw error;

  return {
    success: true,
    data: (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      assignedSites: Array.isArray(r.assigned_sites) ? r.assigned_sites : [],
      faceDescriptor: descriptorText(r.face_descriptor),
      transportPrice: num(r.transport_price, 0),
    })),
  };
}

async function getSitesAction(payload: JsonRec): Promise<JsonRec> {
  const employeeFilter = String(payload.employeeId || "");

  const { data: sites, error: sitesError } = await db
    .from("sites")
    .select("id, name, latitude, longitude, radius, transport_price")
    .order("created_at", { ascending: true });
  if (sitesError) throw sitesError;

  const out = (sites || []).map((s) => ({
    id: String(s.id),
    name: s.name,
    latitude: num(s.latitude, 0),
    longitude: num(s.longitude, 0),
    radius: num(s.radius, 20),
    transportPrice: num(s.transport_price, 0),
    isTemporary: false,
  }));

  let reqQuery = db
    .from("site_requests")
    .select("id, employee_id, suggested_name, latitude, longitude, status, transport_price, temp_radius, approved_at, timestamp")
    .eq("status", "approved_today")
    .order("timestamp", { ascending: true });
  if (employeeFilter) reqQuery = reqQuery.eq("employee_id", employeeFilter);

  const { data: temp, error: tempError } = await reqQuery;
  if (tempError) throw tempError;

  for (const r of temp || []) {
    if (!activeToday(r)) continue;
    out.push({
      id: String(r.id),
      name: r.suggested_name,
      latitude: num(r.latitude, 0),
      longitude: num(r.longitude, 0),
      radius: num(r.temp_radius, 100),
      transportPrice: num(r.transport_price, 0),
      isTemporary: true,
      temporaryForEmployeeId: String(r.employee_id),
      approvedAt: r.approved_at || "",
      approvalMode: "today",
    });
  }

  return { success: true, data: out };
}

async function getAttendanceAction(payload: JsonRec): Promise<JsonRec> {
  const employeeId = String(payload.employeeId || "");
  let q = db
    .from("attendance")
    .select("employee_id, employee_name, site_id, site_name, check_in, check_out, latitude, longitude, status, total_hours, transport_price")
    .order("check_in", { ascending: true });
  if (employeeId) q = q.eq("employee_id", employeeId);

  const { data, error } = await q;
  if (error) throw error;

  const ctx = await transportCtx();
  return {
    success: true,
    data: (data || []).map((r) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      siteId: r.site_id,
      siteName: r.site_name,
      checkIn: r.check_in,
      checkOut: r.check_out,
      latitude: r.latitude,
      longitude: r.longitude,
      status: r.status,
      totalHours: r.total_hours,
      transportPrice: resolveTransport(r.transport_price, r.employee_id, r.site_id, ctx),
    })),
  };
}

async function getSettingsAction(): Promise<JsonRec> {
  return { success: true, data: await getSettings() };
}

async function getSiteRequestsAction(): Promise<JsonRec> {
  const { data, error } = await db
    .from("site_requests")
    .select(
      "id, employee_id, employee_name, latitude, longitude, suggested_name, map_link, status, timestamp, " +
        "transport_price, note, receipt_url, receipt_name, temp_radius, approved_at, map_latitude, map_longitude, auto_meta",
    )
    .order("timestamp", { ascending: true });
  if (error) throw error;

  return {
    success: true,
    data: (data || []).map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      latitude: r.latitude,
      longitude: r.longitude,
      suggestedName: r.suggested_name,
      mapLink: r.map_link,
      status: r.status,
      timestamp: r.timestamp,
      transportPrice: num(r.transport_price, 0),
      note: String(r.note || ""),
      receiptUrl: String(r.receipt_url || ""),
      receiptName: String(r.receipt_name || ""),
      tempRadius: num(r.temp_radius, 100),
      approvedAt: r.approved_at || "",
      mapLatitude: r.map_latitude === null ? null : num(r.map_latitude, 0),
      mapLongitude: r.map_longitude === null ? null : num(r.map_longitude, 0),
      autoMeta: String(r.auto_meta || ""),
      isAutoApproved: String(r.auto_meta || "") === AUTO_META,
      isActiveToday: activeToday({ status: r.status, approved_at: r.approved_at, timestamp: r.timestamp }),
    })),
  };
}

async function loginAction(payload: JsonRec): Promise<JsonRec> {
  const identifier = String(payload.identifier || payload.email || payload.phone || "").trim();
  const password = String(payload.password || "");
  const role = String(payload.role || "").trim();
  if (!identifier || !password) throw new Error("Identifier and password are required");

  const ne = emailNorm(identifier);
  const np = phoneNorm(identifier);

  const { data, error } = await db
    .from("employees")
    .select("id, name, email, password, phone, role, assigned_sites, face_descriptor, transport_price")
    .eq("password", password);
  if (error) throw error;

  const user = (data || []).find((r) => emailNorm(r.email) === ne || (np && phoneNorm(r.phone) === np));
  if (!user) throw new Error("Invalid login credentials or insufficient permissions");
  if (role && String(user.role) !== role) throw new Error("Invalid login credentials or insufficient permissions");

  return {
    success: true,
    message: "Login successful",
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      assignedSites: Array.isArray(user.assigned_sites) ? user.assigned_sites : [],
      faceDescriptor: descriptorText(user.face_descriptor),
      transportPrice: num(user.transport_price, 0),
    },
  };
}

async function sendOtpAction(payload: JsonRec): Promise<JsonRec> {
  const email = emailNorm(payload.email);
  const phone = phoneNorm(payload.phone);
  if (!email) throw new Error("Email is required");
  if (!phone) throw new Error("Phone is required");

  const { data, error } = await db.from("employees").select("id, email, phone");
  if (error) throw error;
  if ((data || []).some((r) => emailNorm(r.email) === email)) throw new Error("This email is already registered");
  if ((data || []).some((r) => phoneNorm(r.phone) === phone)) throw new Error("Phone already registered");

  const code = String(Math.floor(1000 + Math.random() * 9000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: upsertError } = await db.from("otp_codes").upsert(
    { email, phone, code, expires_at: expiresAt, created_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  if (upsertError) throw upsertError;

  const out: JsonRec = {
    success: true,
    message: "OTP generated. Connect an email provider in this Edge Function to deliver it.",
  };
  if (OTP_DEBUG) out.debugCode = code;
  return out;
}

async function verifyOtpAction(payload: JsonRec): Promise<JsonRec> {
  const email = emailNorm(payload.email);
  const code = String(payload.code || "").trim();
  if (!email || !code) throw new Error("Email and OTP are required");

  const { data, error } = await db.from("otp_codes").select("email, code, expires_at").eq("email", email).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("OTP is invalid or expired");
  if (String(data.code) !== code) throw new Error("OTP is invalid or expired");

  const exp = new Date(String(data.expires_at || ""));
  if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
    await db.from("otp_codes").delete().eq("email", email);
    throw new Error("OTP is invalid or expired");
  }

  await db.from("otp_codes").delete().eq("email", email);
  return { success: true, message: "OTP verified" };
}
async function resolveMapLinkAction(payload: JsonRec): Promise<JsonRec> {
  return await resolveMapLink(payload.link);
}

async function saveEmployeeAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  const name = String(payload.name || "").trim();
  const email = emailNorm(payload.email);
  const phone = phoneNorm(payload.phone);
  const password = String(payload.password || "").trim();
  const role = String(payload.role || "employee").trim() || "employee";

  if (!id) throw new Error("Employee ID is required");
  if (!name) throw new Error("Employee name is required");
  if (!password) throw new Error("Password is required");

  await assertUniqueContacts(email, phone);

  const { error } = await db.from("employees").insert({
    id,
    name,
    email,
    password,
    phone,
    role,
    assigned_sites: splitSites(payload.assignedSites),
    face_descriptor: parseDescriptor(payload.faceDescriptor),
    transport_price: num(payload.transportPrice, 0),
  });
  if (error) throw error;

  return { success: true, message: "Employee saved successfully" };
}

async function updateEmployeeAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Employee ID is required");

  const { data: current, error: currentError } = await db.from("employees").select("id, password").eq("id", id).maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw new Error("Employee not found");

  const email = emailNorm(payload.email);
  const phone = phoneNorm(payload.phone);
  await assertUniqueContacts(email, phone, id);

  const finalPassword = String(payload.password || "").trim() || String(current.password || "");
  const transportPrice = num(payload.transportPrice, 0);

  const { error: updateError } = await db
    .from("employees")
    .update({
      name: String(payload.name || ""),
      email,
      password: finalPassword,
      phone,
      role: String(payload.role || "employee"),
      assigned_sites: splitSites(payload.assignedSites),
      face_descriptor: parseDescriptor(payload.faceDescriptor),
      transport_price: transportPrice,
    })
    .eq("id", id);
  if (updateError) throw updateError;

  const { error: syncError } = await db
    .from("attendance")
    .update({ transport_price: transportPrice })
    .eq("employee_id", id)
    .not("site_id", "like", "REQ%");
  if (syncError) throw syncError;

  return { success: true, message: "Employee updated successfully" };
}

async function deleteEmployeeAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Employee ID is required");
  const { error } = await db.from("employees").delete().eq("id", id);
  if (error) throw error;
  return { success: true, message: "Employee deleted successfully" };
}

async function saveSiteAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  const name = String(payload.name || "").trim();
  const lat = num(payload.latitude, Number.NaN);
  const lng = num(payload.longitude, Number.NaN);
  const radius = num(payload.radius, Number.NaN);

  if (!id) throw new Error("Site ID is required");
  if (!name) throw new Error("Site name is required");
  if (!latLngOk(lat, lng)) throw new Error("Invalid site coordinates");
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Invalid site radius");

  const { error } = await db.from("sites").insert({
    id,
    name,
    latitude: lat,
    longitude: lng,
    radius,
    transport_price: num(payload.transportPrice, 0),
  });
  if (error) throw error;

  return { success: true, message: "Site saved successfully" };
}

async function updateSiteAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  const lat = num(payload.latitude, Number.NaN);
  const lng = num(payload.longitude, Number.NaN);
  const radius = num(payload.radius, Number.NaN);

  if (!id) throw new Error("Site ID is required");
  if (!latLngOk(lat, lng)) throw new Error("Invalid site coordinates");
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Invalid site radius");

  const { error } = await db
    .from("sites")
    .update({
      name: String(payload.name || "").trim(),
      latitude: lat,
      longitude: lng,
      radius,
      transport_price: num(payload.transportPrice, 0),
    })
    .eq("id", id);
  if (error) throw error;

  return { success: true, message: "Site updated successfully" };
}

async function deleteSiteAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Site ID is required");
  const { error } = await db.from("sites").delete().eq("id", id);
  if (error) throw error;
  return { success: true, message: "Site deleted successfully" };
}

async function updateSettingsAction(payload: JsonRec): Promise<JsonRec> {
  const settings = payload.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("settings object is required");

  const rows = Object.entries(settings as Record<string, unknown>).map(([key, value]) => ({ key, value: String(value ?? "") }));
  if (!rows.length) return { success: true, message: "No settings to update" };

  const { error } = await db.from("settings").upsert(rows, { onConflict: "key" });
  if (error) throw error;
  return { success: true, message: "Settings updated successfully" };
}

async function addSiteRequestAction(payload: JsonRec): Promise<JsonRec> {
  const employeeId = String(payload.employeeId || "").trim();
  const employeeName = String(payload.employeeName || "").trim();
  const suggestedName = String(payload.suggestedName || "").trim();
  const mapLink = String(payload.mapLink || "").trim();
  const note = String(payload.note || "").trim();
  const lat = num(payload.latitude, Number.NaN);
  const lng = num(payload.longitude, Number.NaN);

  if (!employeeId) throw new Error("Employee ID is required");
  if (!employeeName) throw new Error("Employee name is required");
  if (!suggestedName) throw new Error("Suggested site name is required");
  if (!latLngOk(lat, lng)) throw new Error("Valid GPS coordinates are required");

  let mapLat: number | null = null;
  let mapLng: number | null = null;
  let normalizedLink = mapLink;

  if (mapLink) {
    const v = await validateMapLink(mapLink, lat, lng, AUTO_MAX_METERS);
    if (!v.success) throw new Error(String(v.message || "Map link validation failed"));
    normalizedLink = String(v.url || mapLink);
    mapLat = num(v.lat, Number.NaN);
    mapLng = num(v.lng, Number.NaN);
  }

  const { error } = await db.from("site_requests").insert({
    id: requestId(),
    employee_id: employeeId,
    employee_name: employeeName,
    latitude: lat,
    longitude: lng,
    suggested_name: suggestedName,
    map_link: normalizedLink || null,
    status: "pending",
    timestamp: new Date().toISOString(),
    transport_price: 120,
    note,
    receipt_url: null,
    receipt_name: null,
    temp_radius: null,
    approved_at: null,
    map_latitude: Number.isFinite(mapLat) ? mapLat : null,
    map_longitude: Number.isFinite(mapLng) ? mapLng : null,
    auto_meta: null,
  });
  if (error) throw error;

  return {
    success: true,
    message: "Site request submitted successfully. Auto-approval may activate after 2 minutes if checks pass.",
    attachmentSaved: false,
  };
}

async function approveSiteRequestAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  const mode = String(payload.mode || "today").trim();
  if (!id) throw new Error("Request ID is required");

  const { data: req, error: reqError } = await db
    .from("site_requests")
    .select("id, suggested_name, latitude, longitude")
    .eq("id", id)
    .maybeSingle();
  if (reqError) throw reqError;
  if (!req) throw new Error("Site request not found");

  const tPrice = num(payload.transportPrice, 120);
  const radius = num(payload.radius, 100);
  const approvedAt = new Date().toISOString();

  if (mode === "always") {
    const { error: createSiteError } = await db.from("sites").insert({
      id: siteId(),
      name: String(payload.name || req.suggested_name || "New Site"),
      latitude: num(req.latitude, 0),
      longitude: num(req.longitude, 0),
      radius,
      transport_price: tPrice,
    });
    if (createSiteError) throw createSiteError;

    const { error: updateReqError } = await db
      .from("site_requests")
      .update({ status: "approved", temp_radius: null, auto_meta: null, transport_price: tPrice, approved_at: approvedAt })
      .eq("id", id);
    if (updateReqError) throw updateReqError;
  } else {
    const { error: updateReqError } = await db
      .from("site_requests")
      .update({ status: "approved_today", temp_radius: radius, auto_meta: null, transport_price: tPrice, approved_at: approvedAt })
      .eq("id", id);
    if (updateReqError) throw updateReqError;
  }

  const { error: attendanceError } = await db.from("attendance").update({ transport_price: tPrice }).eq("site_id", id);
  if (attendanceError) throw attendanceError;

  return { success: true, message: "Site request approved successfully." };
}

async function rejectSiteRequestAction(payload: JsonRec): Promise<JsonRec> {
  const id = String(payload.id || "").trim();
  if (!id) throw new Error("Request ID is required");

  const { data: req, error: reqError } = await db
    .from("site_requests")
    .select("id, employee_id, status, approved_at, timestamp")
    .eq("id", id)
    .maybeSingle();
  if (reqError) throw reqError;
  if (!req) throw new Error("Site request not found");

  let canceled = 0;
  if (String(req.status || "") === "approved_today") {
    canceled = await deleteTempAttendanceForRequestDay({
      id: String(req.id),
      employee_id: String(req.employee_id),
      approved_at: req.approved_at,
      timestamp: String(req.timestamp || ""),
    });
  }

  const { error: updateError } = await db.from("site_requests").update({ status: "rejected", temp_radius: null }).eq("id", id);
  if (updateError) throw updateError;

  return {
    success: true,
    message:
      canceled > 0
        ? `Request rejected. Removed ${canceled} attendance record(s) for the approval day.`
        : "Request rejected.",
    canceledAttendanceCount: canceled,
  };
}
async function addAttendanceAction(payload: JsonRec): Promise<JsonRec> {
  const employeeId = String(payload.employeeId || "").trim();
  const employeeName = String(payload.employeeName || "").trim();
  if (!employeeId || !employeeName) throw new Error("Employee ID and name are required");

  const site = await validateAll(payload);

  const { data: openRows, error: openError } = await db
    .from("attendance")
    .select("id, check_in")
    .eq("employee_id", employeeId)
    .is("check_out", null);
  if (openError) throw openError;

  const today = dateKey(new Date());
  if ((openRows || []).some((r) => dateKey(r.check_in) === today)) {
    throw new Error("You already have an open check-in today. Please check out first.");
  }

  const checkIn = String(payload.checkIn || new Date().toISOString());
  const checkInDate = new Date(checkIn);
  if (Number.isNaN(checkInDate.getTime())) throw new Error("Invalid check-in time");

  const settings = await getSettings();
  const [startH, startM] = hhmm(settings.workStartTime, "09:15").split(":").map((x) => Number.parseInt(x, 10));
  const t = dayHourMinute(checkInDate);

  let status = "present";
  if (t.day === 5 || t.day === 6) status = "overtime";
  else if (t.hour > startH || (t.hour === startH && t.minute > startM)) status = "late";

  const ctx = await transportCtx();
  const transportPrice = resolveTransport(site.transportPrice, employeeId, site.id, ctx);

  const { error: insertError } = await db.from("attendance").insert({
    employee_id: employeeId,
    employee_name: employeeName,
    site_id: site.id,
    site_name: site.name,
    check_in: checkIn,
    check_out: null,
    latitude: num(payload.latitude, 0),
    longitude: num(payload.longitude, 0),
    status,
    total_hours: null,
    transport_price: transportPrice,
  });
  if (insertError) throw insertError;

  return {
    success: true,
    message: `Check-in recorded at ${site.name}${transportPrice ? ` (transport: ${transportPrice})` : ""}`,
  };
}

async function checkoutAttendanceAction(payload: JsonRec): Promise<JsonRec> {
  const employeeId = String(payload.employeeId || "").trim();
  if (!employeeId) throw new Error("Employee ID is required");

  await validateAll(payload);

  const { data: open, error: openError } = await db
    .from("attendance")
    .select("id, check_in")
    .eq("employee_id", employeeId)
    .is("check_out", null)
    .order("check_in", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openError) throw openError;
  if (!open) throw new Error("No open attendance session found for checkout");

  const checkout = String(payload.checkOut || new Date().toISOString());
  const outDate = new Date(checkout);
  const inDate = new Date(String(open.check_in || ""));
  if (Number.isNaN(outDate.getTime()) || Number.isNaN(inDate.getTime())) throw new Error("Invalid checkout/check-in timestamps");

  const totalHours = ((outDate.getTime() - inDate.getTime()) / 36e5).toFixed(2);

  const { error: updateError } = await db
    .from("attendance")
    .update({ check_out: checkout, total_hours: Number.parseFloat(totalHours) })
    .eq("id", open.id);
  if (updateError) throw updateError;

  return { success: true, message: `Checkout recorded. Total hours: ${totalHours}` };
}

const createTriggersAction = async (): Promise<JsonRec> => ({
  success: true,
  message: "Supabase migration active. Use Supabase Cron + Edge Functions for scheduled reports.",
});

const sendManualReportAction = async (): Promise<JsonRec> => ({
  success: false,
  message: "Manual email reports are not implemented in this Supabase starter.",
});

const sendEmployeeDetailedReportAction = async (): Promise<JsonRec> => ({
  success: false,
  message: "Employee detailed email reports are not implemented in this Supabase starter.",
});

async function dispatch(action: string, payload: JsonRec): Promise<JsonRec> {
  if (action === "getEmployees") return getEmployeesAction();
  if (action === "getSites") return getSitesAction(payload);
  if (action === "getAttendance") return getAttendanceAction(payload);
  if (action === "getSettings") return getSettingsAction();
  if (action === "getSiteRequests") return getSiteRequestsAction();

  if (action === "createTriggers") return createTriggersAction();
  if (action === "sendManualReport") return sendManualReportAction();
  if (action === "sendEmployeeDetailedReport") return sendEmployeeDetailedReportAction();
  if (action === "login") return loginAction(payload);
  if (action === "sendOTP") return sendOtpAction(payload);
  if (action === "verifyOTP") return verifyOtpAction(payload);
  if (action === "resolveMapLink") return resolveMapLinkAction(payload);
  if (action === "saveEmployee") return saveEmployeeAction(payload);
  if (action === "updateEmployee") return updateEmployeeAction(payload);
  if (action === "deleteEmployee") return deleteEmployeeAction(payload);
  if (action === "saveSite") return saveSiteAction(payload);
  if (action === "updateSite") return updateSiteAction(payload);
  if (action === "deleteSite") return deleteSiteAction(payload);
  if (action === "updateSettings") return updateSettingsAction(payload);
  if (action === "addSiteRequest") return addSiteRequestAction(payload);
  if (action === "approveSiteRequest") return approveSiteRequestAction(payload);
  if (action === "rejectSiteRequest") return rejectSiteRequestAction(payload);
  if (action === "addAttendance") return addAttendanceAction(payload);
  if (action === "checkoutAttendance") return checkoutAttendanceAction(payload);

  return { success: false, message: "Unknown action" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = new URL(req.url);
    let action = "";
    let payload: JsonRec = {};

    if (req.method === "GET") {
      action = String(url.searchParams.get("action") || "");
      payload = Object.fromEntries(url.searchParams.entries());
    } else if (req.method === "POST") {
      payload = (await req.json()) as JsonRec;
      action = String(payload.action || "");
    } else {
      return ok({ success: false, message: "Unsupported HTTP method" }, 405);
    }

    return ok(await dispatch(action, payload));
  } catch (e) {
    return ok({ success: false, message: errText(e) });
  }
});
