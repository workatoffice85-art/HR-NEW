/////////////////////////////
// 🔥 CONFIG
/////////////////////////////
var FACE_THRESHOLD = 0.6;
var AUTO_APPROVAL_WAIT_MS = 2 * 60 * 1000;
var AUTO_APPROVAL_MAX_DISTANCE_METERS = 700;
var AUTO_APPROVAL_META = "auto_2min_700m";

/////////////////////////////
// 🔥 GET SPREADSHEET
/////////////////////////////
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/////////////////////////////
// 🔥 AUTO CREATE SHEETS
/////////////////////////////
function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) sheet.appendRow(headers);
  }
  return sheet;
}

var SITE_REQUEST_HEADERS = [
  "id",
  "employeeId",
  "employeeName",
  "latitude",
  "longitude",
  "suggestedName",
  "mapLink",
  "status",
  "timestamp",
  "transportPrice",
  "note",
  "receiptUrl",
  "receiptName",
  "tempRadius",
  "approvedAt",
  "mapLatitude",
  "mapLongitude",
  "autoMeta"
];

var SITE_REQUEST_COL = {
  ID: 0,
  EMPLOYEE_ID: 1,
  EMPLOYEE_NAME: 2,
  LATITUDE: 3,
  LONGITUDE: 4,
  SUGGESTED_NAME: 5,
  MAP_LINK: 6,
  STATUS: 7,
  CREATED_AT: 8,
  TRANSPORT_PRICE: 9,
  NOTE: 10,
  RECEIPT_URL: 11,
  RECEIPT_NAME: 12,
  TEMP_RADIUS: 13,
  APPROVED_AT: 14,
  MAP_LATITUDE: 15,
  MAP_LONGITUDE: 16,
  AUTO_META: 17
};

function ensureSheetHeaders(sheet, headers) {
  if (!sheet || !headers || !headers.length) return;

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  var requiredColumns = headers.length;
  if (sheet.getLastColumn() < requiredColumns) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), requiredColumns - sheet.getLastColumn());
  }

  var current = sheet.getRange(1, 1, 1, requiredColumns).getValues()[0];
  var changed = false;
  for (var i = 0; i < requiredColumns; i++) {
    if (String(current[i] || "") !== headers[i]) {
      current[i] = headers[i];
      changed = true;
    }
  }

  if (changed) {
    sheet.getRange(1, 1, 1, requiredColumns).setValues([current]);
  }
}

function getSiteRequestsSheet() {
  var sheet = getOrCreateSheet("siteRequests", SITE_REQUEST_HEADERS);
  ensureSheetHeaders(sheet, SITE_REQUEST_HEADERS);
  return sheet;
}

function getTodayKey() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function toDateKey(value) {
  if (!value) return "";
  var dateObj = new Date(value);
  if (isNaN(dateObj.getTime())) return "";
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function isApprovedTodayRequestActive(row) {
  if (!row || String(row[SITE_REQUEST_COL.STATUS] || "") !== "approved_today") return false;
  var approvedAt = row[SITE_REQUEST_COL.APPROVED_AT] || row[SITE_REQUEST_COL.CREATED_AT];
  return toDateKey(approvedAt) === getTodayKey();
}

function isFiniteNumberValue(value) {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
}

function decodeUriSafely(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (e) {
    return String(value || "");
  }
}

function isLatLngInRange(lat, lng) {
  return isFiniteNumberValue(lat) &&
         isFiniteNumberValue(lng) &&
         Math.abs(lat) <= 90 &&
         Math.abs(lng) <= 180;
}

function extractLatLngFromMapText(text) {
  var raw = String(text || "");
  if (!raw) return null;

  var candidates = [raw];
  var decoded = decodeUriSafely(raw);
  if (decoded !== raw) candidates.push(decoded);
  var decodedTwice = decodeUriSafely(decoded);
  if (decodedTwice !== decoded && decodedTwice !== raw) candidates.push(decodedTwice);

  var patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&]q=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
    /[?&]query=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
    /center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /place\/[^\/]+\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i
  ];

  for (var i = 0; i < candidates.length; i++) {
    for (var p = 0; p < patterns.length; p++) {
      var match = candidates[i].match(patterns[p]);
      if (!match) continue;
      var lat = parseFloat(match[1]);
      var lng = parseFloat(match[2]);
      if (isLatLngInRange(lat, lng)) {
        return { lat: lat, lng: lng };
      }
    }
  }

  return null;
}

function resolveMapLinkData(link) {
  var url = String(link || "").trim();
  if (!url) {
    return { success: false, message: "Map link is required." };
  }

  try {
    for (var i = 0; i < 5; i++) {
      var res = UrlFetchApp.fetch(url, {
        followRedirects: false,
        muteHttpExceptions: true,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HRSystem/1.0)" }
      });
      var loc = res.getHeaders()["Location"] || res.getHeaders()["location"];
      if (!loc) break;
      if (/^https?:\/\//i.test(loc)) {
        url = loc;
      } else if (String(loc).indexOf("/") === 0) {
        url = "https://www.google.com" + loc;
      } else {
        break;
      }
    }

    var extracted = extractLatLngFromMapText(url);

    if (!extracted) {
      var htmlRes = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HRSystem/1.0)" }
      }).getContentText();
      extracted = extractLatLngFromMapText(htmlRes);
      if (!extracted) {
        var htmlMatch = htmlRes.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/) ||
                        htmlRes.match(/\[\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/) ||
                        htmlRes.match(/\"(-?\d+\.\d+),(-?\d+\.\d+)\"/);
        if (htmlMatch) {
          var htmlLat = parseFloat(htmlMatch[1]);
          var htmlLng = parseFloat(htmlMatch[2]);
          if (isLatLngInRange(htmlLat, htmlLng)) {
            extracted = { lat: htmlLat, lng: htmlLng };
          }
        }
      }
    }

    if (extracted &&
        Math.abs(extracted.lat - 37.42) < 0.05 &&
        Math.abs(extracted.lng + 122.08) < 0.05) {
      extracted = null;
    }

    return {
      success: true,
      url: url,
      lat: extracted ? extracted.lat : null,
      lng: extracted ? extracted.lng : null
    };
  } catch (e) {
    return { success: false, message: "Failed to parse map link: " + e.toString() };
  }
}

function validateMapLinkDistance(link, referenceLat, referenceLng, maxDistanceMeters) {
  var refLat = parseFloat(referenceLat);
  var refLng = parseFloat(referenceLng);
  if (!isFiniteNumberValue(refLat) || !isFiniteNumberValue(refLng)) {
    return { success: false, message: "Invalid reference coordinates." };
  }

  var resolved = resolveMapLinkData(link);
  if (!resolved.success) return resolved;

  var mapLat = parseFloat(resolved.lat);
  var mapLng = parseFloat(resolved.lng);
  if (!isFiniteNumberValue(mapLat) || !isFiniteNumberValue(mapLng)) {
    return { success: false, message: "Could not extract map coordinates from link." };
  }

  var distance = getDistance(refLat, refLng, mapLat, mapLng);
  if (distance > maxDistanceMeters) {
    return {
      success: false,
      message: "Map link is too far from the selected location (" + distance.toFixed(0) + "m)."
    };
  }

  return {
    success: true,
    url: resolved.url,
    lat: mapLat,
    lng: mapLng,
    distance: distance
  };
}

function deleteAttendanceForTemporaryRequestDay(requestRow) {
  if (!requestRow) return 0;

  var requestId = String(requestRow[SITE_REQUEST_COL.ID] || "");
  var employeeId = String(requestRow[SITE_REQUEST_COL.EMPLOYEE_ID] || "");
  var targetDateKey = toDateKey(requestRow[SITE_REQUEST_COL.APPROVED_AT] || requestRow[SITE_REQUEST_COL.CREATED_AT]);
  if (!requestId || !employeeId || !targetDateKey) return 0;

  var attendanceSheet = getOrCreateSheet("attendance",
    ["employeeId","employeeName","siteId","siteName","checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
  );
  var rows = attendanceSheet.getDataRange().getValues();
  if (rows.length <= 1) return 0;

  var deletedCount = 0;
  for (var i = rows.length - 1; i >= 1; i--) {
    var row = rows[i];
    if (String(row[0]) !== employeeId) continue;
    if (String(row[2]) !== requestId) continue;
    if (toDateKey(row[4]) !== targetDateKey) continue;
    attendanceSheet.deleteRow(i + 1);
    deletedCount++;
  }

  return deletedCount;
}

/////////////////////////////
// 🔥 DISTANCE
/////////////////////////////
function getDistance(lat1, lon1, lat2, lon2) {
  var R = 6371e3;
  var f1 = lat1 * Math.PI/180;
  var f2 = lat2 * Math.PI/180;
  var df = (lat2-lat1) * Math.PI/180;
  var dl = (lon2-lon1) * Math.PI/180;

  var a = Math.sin(df/2)**2 +
          Math.cos(f1)*Math.cos(f2) *
          Math.sin(dl/2)**2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/////////////////////////////
// 🔥 FACE DISTANCE
/////////////////////////////
function getFaceDistance(a, b) {
  if (!a || !b || a.length !== 128 || b.length !== 128) return 1;
  var sum = 0;
  for (var i=0;i<128;i++) sum += Math.pow(a[i]-b[i],2);
  return Math.sqrt(sum);
}

function normalizeTimeToHHmm(value, fallback) {
  var defaultTime = fallback || "09:00";
  if (value === null || value === undefined || value === "") return defaultTime;

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }

  if (typeof value === "number" && !isNaN(value)) {
    var totalMinutes;
    if (value >= 0 && value < 1) {
      totalMinutes = Math.round(value * 24 * 60);
    } else if (value >= 0 && value <= 23) {
      totalMinutes = Math.round(value * 60);
    } else {
      return defaultTime;
    }
    var hhNum = Math.floor(totalMinutes / 60) % 24;
    var mmNum = totalMinutes % 60;
    var hh = ("0" + hhNum).slice(-2);
    var mm = ("0" + mmNum).slice(-2);
    return hh + ":" + mm;
  }

  var text = String(value).trim();
  var match = text.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (match) {
    var h = Math.max(0, Math.min(23, parseInt(match[1], 10)));
    var m = Math.max(0, Math.min(59, parseInt(match[2], 10)));
    return ("0" + h).slice(-2) + ":" + ("0" + m).slice(-2);
  }

  return defaultTime;
}

function toNumberSafe(value, fallback) {
  var defaultNumber = (typeof fallback === "undefined") ? 0 : fallback;
  if (value === null || value === undefined || value === "") return defaultNumber;
  if (typeof value === "number") return isNaN(value) ? defaultNumber : value;
  if (Object.prototype.toString.call(value) === "[object Date]") return defaultNumber;

  var text = String(value).trim();
  if (!text) return defaultNumber;

  // Arabic-Indic digits
  text = text.replace(/[\u0660-\u0669]/g, function(ch) { return String(ch.charCodeAt(0) - 0x0660); });
  // Eastern Arabic-Indic (Persian) digits
  text = text.replace(/[\u06F0-\u06F9]/g, function(ch) { return String(ch.charCodeAt(0) - 0x06F0); });

  // Normalize common separators and remove currency text/symbols
  text = text.replace(/[\u200f\u200e\s]/g, "");
  text = text.replace(/\u066C/g, "");
  text = text.replace(/,/g, "");
  text = text.replace(/\u060C/g, "");
  text = text.replace(/\u066B/g, ".");
  text = text.replace(/[^\d.\-]/g, "");

  if (!text) return defaultNumber;

  // Keep only first decimal point if more than one exists
  var firstDot = text.indexOf(".");
  if (firstDot !== -1) {
    text = text.substring(0, firstDot + 1) + text.substring(firstDot + 1).replace(/\./g, "");
  }

  var parsed = parseFloat(text);
  return isNaN(parsed) ? defaultNumber : parsed;
}

function normalizeEmailValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhoneValue(value) {
  var phone = String(value || "").trim();
  if (!phone) return "";

  // Arabic-Indic digits
  phone = phone.replace(/[\u0660-\u0669]/g, function(ch) { return String(ch.charCodeAt(0) - 0x0660); });
  // Eastern Arabic-Indic (Persian) digits
  phone = phone.replace(/[\u06F0-\u06F9]/g, function(ch) { return String(ch.charCodeAt(0) - 0x06F0); });

  phone = phone.replace(/[\u200f\u200e\s-]/g, "");
  phone = phone.replace(/[()]/g, "");

  if (phone.indexOf("00") === 0) {
    phone = "+" + phone.substring(2);
  }

  // keep only leading plus and digits
  if (phone.indexOf("+") === 0) {
    phone = "+" + phone.substring(1).replace(/[^\d]/g, "");
  } else {
    phone = phone.replace(/[^\d]/g, "");
  }

  // Egypt-friendly normalization:
  // 01xxxxxxxxx -> +201xxxxxxxxx
  if (/^01\d{9}$/.test(phone)) {
    phone = "+2" + phone;
  } else if (/^20\d{10}$/.test(phone)) {
    phone = "+" + phone;
  }

  return phone;
}

function resolveUserByIdentifier(rows, identifier, password) {
  var normalizedIdentifier = String(identifier || "").trim();
  if (!normalizedIdentifier) return null;

  var normalizedEmail = normalizeEmailValue(normalizedIdentifier);
  var normalizedPhone = normalizePhoneValue(normalizedIdentifier);
  var passwordText = String(password);

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[3]) !== passwordText) continue;

    if (normalizeEmailValue(row[2]) === normalizedEmail) return row;
    if (normalizedPhone && normalizePhoneValue(row[4]) === normalizedPhone) return row;
  }

  return null;
}

function ensureEmployeeContactsUnique(rows, email, phone, ignoreEmployeeId) {
  var normalizedEmail = normalizeEmailValue(email);
  var normalizedPhone = normalizePhoneValue(phone);
  var ignoredId = String(ignoreEmployeeId || "");

  if (!normalizedEmail) throw new Error("Email is required");
  if (!normalizedPhone) throw new Error("Phone is required");

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rowId = String(row[0] || "");
    if (ignoredId && rowId === ignoredId) continue;

    if (normalizeEmailValue(row[2]) === normalizedEmail) {
      throw new Error("Email already registered");
    }
    if (normalizePhoneValue(row[4]) === normalizedPhone) {
      throw new Error("Phone already registered");
    }
  }

  return { email: normalizedEmail, phone: normalizedPhone };
}

function getSiteTransportMap() {
  var sheet = getOrCreateSheet("sites", ["id","name","latitude","longitude","radius","transportPrice","mapLink"]);
  var rows = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    map[String(rows[i][0])] = toNumberSafe(rows[i][5], 0);
  }
  return map;
}

function getSiteAllowancesForEmployee(employeeId) {
  var sheet = getOrCreateSheet("siteAllowances", ["employeeId", "siteId", "transportPrice"]);
  var rows = sheet.getDataRange().getValues();
  var allowances = [];
  var empIdStr = String(employeeId);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === empIdStr) {
      allowances.push({
        siteId: String(rows[i][1]),
        transportPrice: toNumberSafe(rows[i][2], 0)
      });
    }
  }
  return allowances;
}

function saveSiteAllowances(employeeId, allowances) {
  var sheet = getOrCreateSheet("siteAllowances", ["employeeId", "siteId", "transportPrice"]);
  var rows = sheet.getDataRange().getValues();
  var empIdStr = String(employeeId);
  
  // Remove existing
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === empIdStr) {
      sheet.deleteRow(i + 1);
    }
  }
  
  // Add new
  if (allowances && allowances.length) {
    allowances.forEach(function(item) {
      sheet.appendRow([empIdStr, item.siteId, toNumberSafe(item.transportPrice, 0)]);
    });
  }
}

function getEmployeeTransportMap() {
  var sheet = getOrCreateSheet("employees",
    ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
  );
  var rows = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    map[String(rows[i][0])] = toNumberSafe(rows[i][8], 0);
  }
  return map;
}

function getRequestTransportMap() {
  var sheet = getSiteRequestsSheet();
  var rows = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    map[String(rows[i][SITE_REQUEST_COL.ID])] = toNumberSafe(rows[i][SITE_REQUEST_COL.TRANSPORT_PRICE], 0);
  }
  return map;
}

function buildTransportContext() {
  return {
    siteMap: getSiteTransportMap(),
    employeeMap: getEmployeeTransportMap(),
    requestMap: getRequestTransportMap()
  };
}

function isRequestSiteId(siteId) {
  return /^REQ/i.test(String(siteId || ""));
}



function resolveTransportPrice(rawTransport, employeeId, siteId, context) {
  var normalizedSiteId = String(siteId || "");
  var normalizedEmployeeId = String(employeeId || "");

  // 1. Check Site Allowances Sheet (Custom mapping)
  var allowanceSheet = getOrCreateSheet("siteAllowances", ["employeeId", "siteId", "transportPrice"]);
  var allowanceRows = allowanceSheet.getDataRange().getValues();
  for (var i = 1; i < allowanceRows.length; i++) {
    if (String(allowanceRows[i][0]) === normalizedEmployeeId && String(allowanceRows[i][1]) === normalizedSiteId) {
      return toNumberSafe(allowanceRows[i][2], 0);
    }
  }

  // 2. Check Temporary site requests
  if (isRequestSiteId(normalizedSiteId)) {
    var requestTransport = context && context.requestMap
      ? toNumberSafe(context.requestMap[normalizedSiteId], null)
      : null;
    if (requestTransport !== null) return requestTransport;
  }

  // 3. Check Employee Default
  var employeeTransport = context && context.employeeMap
    ? toNumberSafe(context.employeeMap[normalizedEmployeeId], null)
    : null;
  if (employeeTransport !== null) return employeeTransport;

  // 4. Check Site Default
  var siteTransport = context && context.siteMap
    ? toNumberSafe(context.siteMap[normalizedSiteId], null)
    : null;
  if (siteTransport !== null) return siteTransport;

  return 0;
}

function syncAttendanceTransportForEmployee(employeeId, employeeTransport) {
  var attendanceSheet = getOrCreateSheet("attendance",
    ["employeeId","employeeName","siteId","siteName","checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
  );
  var rows = attendanceSheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  var normalizedEmployeeId = String(employeeId || "");
  var normalizedTransport = toNumberSafe(employeeTransport, 0);
  var changed = false;

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === normalizedEmployeeId && !isRequestSiteId(rows[i][2])) {
      rows[i][10] = normalizedTransport;
      changed = true;
    }
  }

  if (changed) {
    attendanceSheet.getRange(2, 11, rows.length - 1, 1).setValues(
      rows.slice(1).map(function(r) { return [r[10]]; })
    );
  }
}

function syncAttendanceTransportForRequest(requestId, requestTransport) {
  var attendanceSheet = getOrCreateSheet("attendance",
    ["employeeId","employeeName","siteId","siteName","checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
  );
  var rows = attendanceSheet.getDataRange().getValues();
  if (rows.length <= 1) return;

  var normalizedRequestId = String(requestId || "");
  var normalizedTransport = toNumberSafe(requestTransport, 0);
  var changed = false;

  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === normalizedRequestId) {
      rows[i][10] = normalizedTransport;
      changed = true;
    }
  }

  if (changed) {
    attendanceSheet.getRange(2, 11, rows.length - 1, 1).setValues(
      rows.slice(1).map(function(r) { return [r[10]]; })
    );
  }
}

/////////////////////////////
// 🔥 VALIDATION
/////////////////////////////
function validateAll(ss, data) {

  var empSheet = getOrCreateSheet("employees",
    ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]
  );

  var empRows = empSheet.getDataRange().getValues();
  empRows.shift();

  var user = empRows.find(function(r) { return r[0] == data.employeeId; });
  if (!user) throw new Error("الموظف غير موجود");

  // FACE CHECK
  if (user[7] && data.faceDescriptor) {
    var dist = getFaceDistance(
      JSON.parse(user[7]),
      JSON.parse(data.faceDescriptor)
    );
    if (dist > FACE_THRESHOLD) throw new Error("بصمة الوجه غير متطابقة");
  } else if (user[7] && !data.faceDescriptor) {
    throw new Error("مطلوب توثيق بصمة الوجه للعملية");
  }

  // GPS CHECK
  if (!data.latitude || !data.longitude) throw new Error("يجب توفير إحداثيات الموقع (GPS)");

  var sitesSheet = getOrCreateSheet("sites",
    ["id","name","latitude","longitude","radius","transportPrice","mapLink"]
  );

  var sites = sitesSheet.getDataRange().getValues();
  sites.shift();

  // 1. Check Permanent Sites
  for (var i = 0; i < sites.length; i++) {
    var dist = getDistance(
      parseFloat(data.latitude),
      parseFloat(data.longitude),
      parseFloat(sites[i][2]),
      parseFloat(sites[i][3])
    );
    if (dist <= parseFloat(sites[i][4])) {
      return { id: sites[i][0], name: sites[i][1], transportPrice: toNumberSafe(sites[i][5], 0) };
    }
  }

  // 2. Check Temporary Approvals (Approved for today only)
  var reqSheet = getSiteRequestsSheet();
  var reqRows = reqSheet.getDataRange().getValues();

  for (var j = reqRows.length - 1; j >= 1; j--) {
    var row = reqRows[j];
    if (String(row[SITE_REQUEST_COL.EMPLOYEE_ID]) !== String(data.employeeId)) continue;
    if (!isApprovedTodayRequestActive(row)) continue;

    var tempRadius = toNumberSafe(row[SITE_REQUEST_COL.TEMP_RADIUS], 100);
    var dist = getDistance(
      parseFloat(data.latitude),
      parseFloat(data.longitude),
      parseFloat(row[SITE_REQUEST_COL.LATITUDE]),
      parseFloat(row[SITE_REQUEST_COL.LONGITUDE])
    );
    if (dist <= tempRadius) {
      return {
        id: row[SITE_REQUEST_COL.ID],
        name: row[SITE_REQUEST_COL.SUGGESTED_NAME],
        transportPrice: toNumberSafe(row[SITE_REQUEST_COL.TRANSPORT_PRICE], 0)
      };
    }
  }

  // 3. Auto-Approval Logic:
  // Pending > 2 minutes, employee near requested point, and map link within 700m.
  for (var k = reqRows.length - 1; k >= 1; k--) {
    var reqRow = reqRows[k];
    if (String(reqRow[SITE_REQUEST_COL.EMPLOYEE_ID]) !== String(data.employeeId)) continue;
    if (String(reqRow[SITE_REQUEST_COL.STATUS]) !== "pending") continue;

    var createdAt = new Date(reqRow[SITE_REQUEST_COL.CREATED_AT]);
    var now = new Date();
    if (isNaN(createdAt.getTime())) continue;
    if (now - createdAt < AUTO_APPROVAL_WAIT_MS) continue;

    var reqLat = parseFloat(reqRow[SITE_REQUEST_COL.LATITUDE]);
    var reqLng = parseFloat(reqRow[SITE_REQUEST_COL.LONGITUDE]);
    var currentLat = parseFloat(data.latitude);
    var currentLng = parseFloat(data.longitude);
    if (!isFiniteNumberValue(reqLat) || !isFiniteNumberValue(reqLng) ||
        !isFiniteNumberValue(currentLat) || !isFiniteNumberValue(currentLng)) {
      continue;
    }

    var distToReq = getDistance(currentLat, currentLng, reqLat, reqLng);
    if (distToReq > AUTO_APPROVAL_MAX_DISTANCE_METERS) continue;

    var reqMapLink = String(reqRow[SITE_REQUEST_COL.MAP_LINK] || "").trim();
    if (!reqMapLink) continue; // Auto-approval requires submitted map link

    var mapLat = parseFloat(reqRow[SITE_REQUEST_COL.MAP_LATITUDE]);
    var mapLng = parseFloat(reqRow[SITE_REQUEST_COL.MAP_LONGITUDE]);
    if (!isFiniteNumberValue(mapLat) || !isFiniteNumberValue(mapLng)) {
      var mapValidation = validateMapLinkDistance(reqMapLink, reqLat, reqLng, AUTO_APPROVAL_MAX_DISTANCE_METERS);
      if (!mapValidation.success) continue;
      mapLat = mapValidation.lat;
      mapLng = mapValidation.lng;
      reqSheet.getRange(k + 1, SITE_REQUEST_COL.MAP_LATITUDE + 1).setValue(mapLat);
      reqSheet.getRange(k + 1, SITE_REQUEST_COL.MAP_LONGITUDE + 1).setValue(mapLng);
    } else {
      var reqToLinkDistance = getDistance(reqLat, reqLng, mapLat, mapLng);
      if (reqToLinkDistance > AUTO_APPROVAL_MAX_DISTANCE_METERS) continue;
    }

    var autoApprovedAt = now.toISOString();
    var currentNote = String(reqRow[SITE_REQUEST_COL.NOTE] || "");
    var autoNote = currentNote + (currentNote ? " | " : "") + "[AUTO APPROVED after 2 minutes, within 700m]";

    reqSheet.getRange(k + 1, SITE_REQUEST_COL.STATUS + 1).setValue("approved_today");
    reqSheet.getRange(k + 1, SITE_REQUEST_COL.TEMP_RADIUS + 1).setValue(AUTO_APPROVAL_MAX_DISTANCE_METERS);
    reqSheet.getRange(k + 1, SITE_REQUEST_COL.APPROVED_AT + 1).setValue(autoApprovedAt);
    reqSheet.getRange(k + 1, SITE_REQUEST_COL.NOTE + 1).setValue(autoNote);
    reqSheet.getRange(k + 1, SITE_REQUEST_COL.AUTO_META + 1).setValue(AUTO_APPROVAL_META);

    return {
      id: reqRow[SITE_REQUEST_COL.ID],
      name: reqRow[SITE_REQUEST_COL.SUGGESTED_NAME],
      transportPrice: toNumberSafe(reqRow[SITE_REQUEST_COL.TRANSPORT_PRICE], 120)
    };
  }


  throw new Error("أنت خارج نطاق جميع مواقع العمل المسجلة.");
}

/////////////////////////////
// 🔥 GET API
/////////////////////////////
function doGet(e) {
  var action = e.parameter.action;

  try {

    if (action === "getDashboardData") {
      var ss = getSpreadsheet();
      return json({
        success: true,
        employees: _getEmployeesData(ss),
        sites: _getSitesData(ss),
        attendance: _getAttendanceData(ss),
        settings: _getSettingsData(ss),
        siteRequests: _getSiteRequestsData(ss)
      });
    }

    if (action === "getPortalInitialData") {
      var empId = e.parameter.employeeId;
      if (!empId) throw new Error("Employee ID is required");
      var ss = getSpreadsheet();
      return json({
        success: true,
        sites: _getSitesData(ss, empId),
        attendance: _getAttendanceData(ss, empId)
      });
    }

    if (action === "getEmployees") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
      );

      var d = s.getDataRange().getValues();
      d.shift();

      return json({
        success:true,
        data:d.map(function(r) { 
          var empId = r[0];
          return {
            id:empId, 
            name:r[1], 
            email:r[2], 
            phone:r[4], 
            role:r[5], 
            assignedSites:r[6]?r[6].toString().split(','):[], 
            faceDescriptor:r[7], 
            transportPrice:toNumberSafe(r[8], 0),
            siteAllowances: getSiteAllowancesForEmployee(empId)
          };
        })
      });
    }

    if (action === "getSites") {
      var sitesSheet = getOrCreateSheet("sites",
        ["id","name","latitude","longitude","radius","transportPrice","mapLink"]
      );
      var employeeFilter = String(e.parameter.employeeId || "");
      var sitesRows = sitesSheet.getDataRange().getValues();
      sitesRows.shift();

      var siteData = sitesRows.map(function(r) {
        return {
          id: String(r[0]),
          name: r[1],
          latitude: parseFloat(r[2]),
          longitude: parseFloat(r[3]),
          radius: toNumberSafe(r[4], 20),
          transportPrice: toNumberSafe(r[5], 0),
          mapLink: r[6] || "",
          isTemporary: false
        };
      });

      // Filter by assigned sites if employeeFilter is provided
      if (employeeFilter) {
        var empSheet = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites"]);
        var empRows = empSheet.getDataRange().getValues();
        var assignedStr = "";
        for (var k = 1; k < empRows.length; k++) {
          if (String(empRows[k][0]) === employeeFilter) {
            assignedStr = String(empRows[k][6] || "");
            break;
          }
        }
        if (assignedStr) {
          var assignedArray = assignedStr.split(',').map(function(s) { return s.trim(); });
          siteData = siteData.filter(function(s) { return assignedArray.indexOf(s.id) !== -1; });
        }
      }

      var reqSheet = getSiteRequestsSheet();
      var reqRows = reqSheet.getDataRange().getValues();
      reqRows.shift();

      for (var i = 0; i < reqRows.length; i++) {
        var req = reqRows[i];
        var isApprovedToday = isApprovedTodayRequestActive(req);
        
        // 🚀 AUTO-APPROVAL VISIBILITY FIX:
        // Also include pending requests that meet the auto-approval criteria
        // so the employee can actually see the site and trigger the check-in.
        var isAutoApprovable = false;
        if (String(req[SITE_REQUEST_COL.STATUS]) === "pending" && employeeFilter && String(req[SITE_REQUEST_COL.EMPLOYEE_ID]) === employeeFilter) {
          var createdAt = new Date(req[SITE_REQUEST_COL.CREATED_AT]);
          var now = new Date();
          if (!isNaN(createdAt.getTime()) && (now - createdAt >= AUTO_APPROVAL_WAIT_MS)) {
             // Check distance if we have current location (approximated or just show it to let them try)
             // We'll show it if it's old enough, and let validateAll handle the actual distance check.
             isAutoApprovable = true;
          }
        }

        if (!isApprovedToday && !isAutoApprovable) continue;
        if (employeeFilter && String(req[SITE_REQUEST_COL.EMPLOYEE_ID]) !== employeeFilter) continue;

        siteData.push({
          id: String(req[SITE_REQUEST_COL.ID]),
          name: (isAutoApprovable ? "[موافقة تلقائية] " : "") + req[SITE_REQUEST_COL.SUGGESTED_NAME],
          latitude: parseFloat(req[SITE_REQUEST_COL.LATITUDE]),
          longitude: parseFloat(req[SITE_REQUEST_COL.LONGITUDE]),
          radius: isAutoApprovable ? AUTO_APPROVAL_MAX_DISTANCE_METERS : toNumberSafe(req[SITE_REQUEST_COL.TEMP_RADIUS], 100),
          transportPrice: toNumberSafe(req[SITE_REQUEST_COL.TRANSPORT_PRICE], 120),
          isTemporary: true,
          temporaryForEmployeeId: String(req[SITE_REQUEST_COL.EMPLOYEE_ID]),
          approvedAt: req[SITE_REQUEST_COL.APPROVED_AT] || "",
          approvalMode: isAutoApprovable ? "auto" : "today"
        });
      }

      return json({ success: true, data: siteData });
    }

    if (action === "getAttendance") {
      var s = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
      );

      var d = s.getDataRange().getValues();
      d.shift();
      var transportContext = buildTransportContext();

      var records = d.map(function(r) {
        var transport = resolveTransportPrice(r[10], r[0], r[2], transportContext);
        var rawHours = r[9];
        var hoursNum = toNumberSafe(rawHours, null);
        
        // If hours are missing or invalid but user has checked out, calculate on the fly
        if ((hoursNum === null || hoursNum === 0) && r[4] && r[5]) {
          try {
             var cIn = new Date(r[4]);
             var cOut = new Date(r[5]);
             if (!isNaN(cIn.getTime()) && !isNaN(cOut.getTime())) {
               hoursNum = parseFloat(((cOut - cIn) / 36e5).toFixed(2));
             }
          } catch(e) { hoursNum = 0; }
        }

        return {
          employeeId:r[0], employeeName:r[1], siteId:r[2], siteName:r[3],
          checkIn:r[4], checkOut:r[5], latitude:r[6], longitude:r[7], status:r[8], 
          totalHours: hoursNum || 0, transportPrice:transport
        };
      });
      
      if(e.parameter.employeeId) {
          records = records.filter(function(r) { return String(r.employeeId) === String(e.parameter.employeeId); });
      }

      return json({ success:true, data:records });
    }

    if (action === "getSettings") {
      var s = getOrCreateSheet("settings", ["key", "value"]);
      var rows = s.getDataRange().getValues();
      var settings = {};
      for (var i = 1; i < rows.length; i++) {
        settings[rows[i][0]] = s.getRange(i + 1, 2).getDisplayValue();
      }
      // Default values if not set
      if (!settings.workStartTime) settings.workStartTime = "09:00";
      if (!settings.workEndTime) settings.workEndTime = "17:00";
      
      return json({ success: true, data: settings });
    }

    if (action === "getSiteRequests") {
      var s = getSiteRequestsSheet();
      var d = s.getDataRange().getValues();
      d.shift();
      return json({
        success: true,
        data: d.map(function(r) {
          return {
            id: r[SITE_REQUEST_COL.ID],
            employeeId: r[SITE_REQUEST_COL.EMPLOYEE_ID],
            employeeName: r[SITE_REQUEST_COL.EMPLOYEE_NAME],
            latitude: r[SITE_REQUEST_COL.LATITUDE],
            longitude: r[SITE_REQUEST_COL.LONGITUDE],
            suggestedName: r[SITE_REQUEST_COL.SUGGESTED_NAME],
            mapLink: r[SITE_REQUEST_COL.MAP_LINK],
            status: r[SITE_REQUEST_COL.STATUS],
            timestamp: r[SITE_REQUEST_COL.CREATED_AT],
            transportPrice: toNumberSafe(r[SITE_REQUEST_COL.TRANSPORT_PRICE], 0),
            note: String(r[SITE_REQUEST_COL.NOTE] || ""),
            receiptUrl: String(r[SITE_REQUEST_COL.RECEIPT_URL] || ""),
            receiptName: String(r[SITE_REQUEST_COL.RECEIPT_NAME] || ""),
            tempRadius: toNumberSafe(r[SITE_REQUEST_COL.TEMP_RADIUS], 100),
            approvedAt: r[SITE_REQUEST_COL.APPROVED_AT] || "",
            mapLatitude: toNumberSafe(r[SITE_REQUEST_COL.MAP_LATITUDE], null),
            mapLongitude: toNumberSafe(r[SITE_REQUEST_COL.MAP_LONGITUDE], null),
            autoMeta: String(r[SITE_REQUEST_COL.AUTO_META] || ""),
            isAutoApproved: String(r[SITE_REQUEST_COL.AUTO_META] || "") === AUTO_APPROVAL_META,
            isActiveToday: isApprovedTodayRequestActive(r)
          };
        })
      });
    }

    return json({success:false,message:"Unknown action"});

  } catch(e){
    return json({success:false,message:e.toString()});
  }
}

/////////////////////////////
// 🔥 POST API
/////////////////////////////
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = getSpreadsheet();
    var action = data.action;

    // 1. CREATE TRIGGERS (Auto Reporting Schedule)
    if (action === "createTriggers") {
      try {
        createTriggers();
        return json({success:true});
      } catch(e) {
        return json({success:false, message: "خطأ في الجدولة: " + e.toString()});
      }
    }

    // 2. SEND MANUAL REPORT (Manual Trigger)
    if (action === "sendManualReport") {
      try {
        return sendManualReport(getSpreadsheet(), data);
      } catch(e) {
        return json({success:false, message: "خطأ في إرسال التقرير: " + e.toString()});
      }
    }

    // 3. SEND EMPLOYEE DETAILED REPORT (Manual Trigger)
    if (action === "sendEmployeeDetailedReport") {
      try {
        return sendEmployeeDetailedReport(data);
      } catch(e) {
        return json({success:false, message: "خطأ في إرسال التقرير التفصيلي: " + e.toString()});
      }
    }

    if (action === "clearProcessedRequests") {
      var s = getSiteRequestsSheet();
      var rows = s.getDataRange().getValues();
      var deletedCount = 0;
      var todayKey = getTodayKey();
      
      for (var i = rows.length - 1; i >= 1; i--) {
        var status = String(rows[i][SITE_REQUEST_COL.STATUS] || "");
        var approvedAt = rows[i][SITE_REQUEST_COL.APPROVED_AT] || rows[i][SITE_REQUEST_COL.CREATED_AT];
        var isOldToday = (status === "approved_today" && toDateKey(approvedAt) !== todayKey);
        
        if (status === "approved" || status === "rejected" || isOldToday) {
          s.deleteRow(i + 1);
          deletedCount++;
        }
      }
      return json({ success: true, message: "تم مسح " + deletedCount + " طلب تمت معالجته بنجاح." });
    }
    
    // LOGIN
    if (action === "login") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
      );

      var rows = s.getDataRange().getValues();
      rows.shift();

      var identifier = data.identifier || data.email || data.phone || "";
      var user = resolveUserByIdentifier(rows, identifier, data.password);

      if (!user) throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");
      if (data.role && user[5] !== data.role) throw new Error("بيانات الدخول غير صحيحة أو لا تملك الصلاحية");

      return json({
        success:true,
        data:{ id:user[0], name:user[1], email:user[2], phone:user[4], role:user[5], assignedSites:user[6]?user[6].toString().split(','):[], faceDescriptor:user[7]||"", transportPrice:toNumberSafe(user[8], 0) },
        message: "تم تسجيل الدخول بنجاح"
      });
    }

    // SEND OTP
    if (action === "sendOTP") {
       var sheet = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]);
       var rows = sheet.getDataRange().getValues();
       rows.shift();
       var normalizedEmail = normalizeEmailValue(data.email);
       var normalizedPhone = normalizePhoneValue(data.phone);
       if (!normalizedEmail) throw new Error("Email is required");
       if (!normalizedPhone) throw new Error("Phone is required");
       data.email = normalizedEmail;
       data.phone = normalizedPhone;
       var exists = rows.find(function(r) { return normalizeEmailValue(r[2]) === normalizedEmail; });
       if(exists) {
           throw new Error("هذا البريد الإلكتروني مسجل مسبقاً، يمكنك تسجيل الدخول مباشرة.");
       }
       var phoneExists = rows.find(function(r) { return normalizePhoneValue(r[4]) === normalizedPhone; });
       if (phoneExists) {
           throw new Error("Phone already registered");
       }
       var code = Math.floor(1000 + Math.random() * 9000).toString();
       CacheService.getScriptCache().put("otp:" + normalizedEmail, code, 600); // 10 minutes cache
       
       // Use GmailApp instead of MailApp for better Outlook deliverability
       // Also adding a sender name
       GmailApp.sendEmail(data.email, "رمز التحقق لتسجيل المستخد الجديد", 
         "مرحبا،\n\nرمز التحقق الخاص بك هو: " + code + "\nالرمز صالح لمدة 10 دقائق.",
         { name: "نظام إدارة الموارد البشرية (HR System)" }
       );
       return json({ success: true, message: "تم إرسال رمز التحقق" });
    }
    
    // VERIFY OTP
    if (data.action === "verifyOTP") {
       var verifyEmail = normalizeEmailValue(data.email);
       var otpCacheKey = "otp:" + verifyEmail;
       var cachedCode = CacheService.getScriptCache().get(otpCacheKey);
       if (cachedCode === String(data.code)) {
           CacheService.getScriptCache().remove(otpCacheKey);
           return json({ success: true, message: "رمز صحيح" });
       } else {
           throw new Error("رمز التحقق غير صحيح أو منتهي الصلاحية");
       }
    }

    // Resolve Google Maps links
    if (data.action === "resolveMapLink") {
      var mapResult = resolveMapLinkData(data.link);
      return json(mapResult);
    }


    // ADD EMPLOYEE
    if (data.action === "saveEmployee") {
      var s = getOrCreateSheet("employees",
        ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]
      );
      var existingRows = s.getDataRange().getValues();
      existingRows.shift();
      var normalizedContacts = ensureEmployeeContactsUnique(existingRows, data.email, data.phone);

      s.appendRow([
        data.id,data.name,normalizedContacts.email,data.password,
        normalizedContacts.phone,data.role,data.assignedSites,data.faceDescriptor,toNumberSafe(data.transportPrice, 0)
      ]);

      if (data.siteAllowances) {
        saveSiteAllowances(data.id, data.siteAllowances);
      }

      return json({success:true, message: "تم حفظ بيانات الموظف بنجاح"});
    }

    // UPDATE EMPLOYEE
    if (data.action === "updateEmployee") {
      var s = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]);
      var rows = s.getDataRange().getValues();
      var normalizedContacts = ensureEmployeeContactsUnique(rows.slice(1), data.email, data.phone, data.id);
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          var incomingPassword = data.password === undefined || data.password === null ? "" : String(data.password).trim();
          var finalPassword = incomingPassword || String(rows[i][3] || "");
          // Update (name to transportPrice)
          s.getRange(i + 1, 2, 1, 6).setValues([[data.name, normalizedContacts.email, finalPassword, normalizedContacts.phone, data.role, data.assignedSites]]);
          var normalizedEmployeeTransport = toNumberSafe(data.transportPrice, 0);
          s.getRange(i+1, 9).setValue(normalizedEmployeeTransport);
          
          if (data.siteAllowances) {
            saveSiteAllowances(data.id, data.siteAllowances);
          }
          
          syncAttendanceTransportForEmployee(data.id, normalizedEmployeeTransport);
          return json({success:true, message: "تم تحديث بيانات الموظف بنجاح"});
        }
      }
      throw new Error("الموظف غير موجود");
    }

    // DELETE EMPLOYEE
    if (data.action === "deleteEmployee") {
      var s = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.deleteRow(i + 1);
          return json({success:true, message: "تم حذف الموظف بنجاح"});
        }
      }
      throw new Error("الموظف غير موجود");
    }

    // ADD SITE
    if (data.action === "saveSite") {
      var s = getOrCreateSheet("sites",
        ["id","name","latitude","longitude","radius","transportPrice","mapLink"]
      );

      s.appendRow([
        data.id,data.name,
        data.latitude,data.longitude,data.radius,toNumberSafe(data.transportPrice, 0),
        data.mapLink || ""
      ]);

      return json({success:true, message: "تم إضافة الموقع بنجاح"});
    }

    // UPDATE SITE
    if (data.action === "updateSite") {
      var s = getOrCreateSheet("sites", ["id","name","latitude","longitude","radius","transportPrice","mapLink"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.getRange(i + 1, 2, 1, 6).setValues([[data.name, data.latitude, data.longitude, data.radius, data.transportPrice, data.mapLink || ""]]);
          return json({success:true, message: "تم تحديث الموقع بنجاح"});
        }
      }
      throw new Error("الموقع غير موجود");
    }

    // DELETE SITE
    if (data.action === "deleteSite") {
      var s = getOrCreateSheet("sites", ["id","name","latitude","longitude","radius","transportPrice","mapLink"]);
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(data.id)) {
          s.deleteRow(i + 1);
          return json({success:true, message: "تم حذف الموقع بنجاح"});
        }
      }
      throw new Error("الموقع غير موجود");
    }

    // UPDATE SETTINGS
    if (data.action === "updateSettings") {
      var s = getOrCreateSheet("settings", ["key", "value"]);
      var rows = s.getDataRange().getValues();
      
      for (var key in data.settings) {
        var found = false;
        for (var i = 1; i < rows.length; i++) {
          if (rows[i][0] === key) {
            s.getRange(i + 1, 2).setValue(data.settings[key]);
            found = true;
            break;
          }
        }
        if (!found) {
          s.appendRow([key, data.settings[key]]);
        }
      }
      return json({ success: true, message: "تم تحديث الإعدادات بنجاح" });
    }

    // SITE REQUESTS
    if (data.action === "addSiteRequest") {
      var s = getSiteRequestsSheet();
      var requestId = "REQ" + Math.floor(10000 + Math.random() * 90000);
      var note = String(data.note || "").trim();
      var mapLink = String(data.mapLink || "").trim();
      var mapLatitude = "";
      var mapLongitude = "";

      if (mapLink) {
        var linkValidation = validateMapLinkDistance(
          mapLink,
          data.latitude,
          data.longitude,
          AUTO_APPROVAL_MAX_DISTANCE_METERS
        );
        if (!linkValidation.success) {
          throw new Error(linkValidation.message);
        }
        mapLink = linkValidation.url || mapLink;
        mapLatitude = linkValidation.lat;
        mapLongitude = linkValidation.lng;
      }

      s.appendRow([
        requestId,
        data.employeeId,
        data.employeeName,
        data.latitude,
        data.longitude,
        data.suggestedName,
        mapLink,
        "pending",
        new Date().toISOString(),
        120,
        note,
        "",
        "",
        "",
        "",
        mapLatitude,
        mapLongitude,
        ""
      ]);
      var submitMessage = "تم إرسال طلب تسجيل الموقع بنجاح للمراجعة. في حال عدم الرد من الإدارة خلال دقيقتين، سيتم تفعيل موافقة تلقائية مؤقتة طالما كنت متواجداً في نفس المكان.";
      return json({ success: true, message: submitMessage, attachmentSaved: false });
    }

    if (data.action === "approveSiteRequest") {
      var reqSheet = getSiteRequestsSheet();
      var sitesSheet = getOrCreateSheet("sites", ["id", "name", "latitude", "longitude", "radius", "transportPrice"]);
      var rows = reqSheet.getDataRange().getValues();
      var approvedRequestTransport = toNumberSafe(data.transportPrice, 120);
      var approvedRadius = toNumberSafe(data.radius, 100);
      var approvedAt = new Date().toISOString();
      
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i];
        if (String(row[SITE_REQUEST_COL.ID]) === String(data.id)) {
          
          if (data.mode === "always") {
            // Add to permanent sites
            sitesSheet.appendRow([
              Math.floor(10000 + Math.random() * 90000),
              data.name || row[SITE_REQUEST_COL.SUGGESTED_NAME],
              row[SITE_REQUEST_COL.LATITUDE],
              row[SITE_REQUEST_COL.LONGITUDE],
              approvedRadius,
              approvedRequestTransport
            ]);
            reqSheet.getRange(i + 1, SITE_REQUEST_COL.STATUS + 1).setValue("approved");
            reqSheet.getRange(i + 1, SITE_REQUEST_COL.TEMP_RADIUS + 1).setValue("");
            reqSheet.getRange(i + 1, SITE_REQUEST_COL.AUTO_META + 1).setValue("");
          } else {
            // Approve for today only
            reqSheet.getRange(i + 1, SITE_REQUEST_COL.STATUS + 1).setValue("approved_today");
            reqSheet.getRange(i + 1, SITE_REQUEST_COL.TEMP_RADIUS + 1).setValue(approvedRadius);
            reqSheet.getRange(i + 1, SITE_REQUEST_COL.AUTO_META + 1).setValue("");
          }
          
          reqSheet.getRange(i + 1, SITE_REQUEST_COL.TRANSPORT_PRICE + 1).setValue(approvedRequestTransport);
          reqSheet.getRange(i + 1, SITE_REQUEST_COL.APPROVED_AT + 1).setValue(approvedAt);
          syncAttendanceTransportForRequest(row[SITE_REQUEST_COL.ID], approvedRequestTransport);
          return json({ success: true, message: "تمت الموافقة على الموقع بنجاح." });
        }
      }
      throw new Error("الطلب غير موجود");
    }

    if (data.action === "rejectSiteRequest") {
      var s = getSiteRequestsSheet();
      var rows = s.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        if (String(rows[i][SITE_REQUEST_COL.ID]) === String(data.id)) {
          var currentStatus = String(rows[i][SITE_REQUEST_COL.STATUS] || "");
          var canceledAttendanceCount = 0;

          if (currentStatus === "approved_today") {
            canceledAttendanceCount = deleteAttendanceForTemporaryRequestDay(rows[i]);
          }

          s.getRange(i + 1, SITE_REQUEST_COL.STATUS + 1).setValue("rejected");
          s.getRange(i + 1, SITE_REQUEST_COL.TEMP_RADIUS + 1).setValue("");

          var rejectionMessage = "تم رفض الطلب.";
          if (currentStatus === "approved_today") {
            if (canceledAttendanceCount > 0) {
              rejectionMessage += " تم إلغاء " + canceledAttendanceCount + " سجل/سجلات حضور من يوم الموافقة.";
            } else {
              rejectionMessage += " لم يتم العثور على حضور مسجل لنفس اليوم.";
            }
          }

          return json({ success: true, message: rejectionMessage, canceledAttendanceCount: canceledAttendanceCount });
        }
      }
      throw new Error("الطلب غير موجود");
    }

    // CHECK-IN
    if (data.action === "addAttendance") {
      var site = validateAll(ss, data);

      var sheet = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
      );

      var rows = sheet.getDataRange().getValues();
      var today = new Date().toDateString();
      for (var i = rows.length - 1; i >= 1; i--) {
        if (rows[i][0] == data.employeeId) {
          var rowDate = new Date(rows[i][4]).toDateString();
          if (rowDate === today && (rows[i][5] === "" || !rows[i][5])) {
            throw new Error("عفواً، لا يمكنك تسجيل الحضور مرتين. لديك عملية حضور مفتوحة اليوم، يرجى الانصراف أولاً.");
          }
        }
      }

      var checkInDate = new Date(data.checkIn);
      var dayOfWeek = checkInDate.getDay();
      var manualStatus = "present";

      // GET SETTINGS
      var settingsSheet = getOrCreateSheet("settings", ["key", "value"]);
      var sRows = settingsSheet.getDataRange().getValues();
      var workStart = "09:15"; // Default
      for(var j=1; j<sRows.length; j++) {
        if(sRows[j][0] === "workStartTime") {
          workStart = sRows[j][1];
          break;
        }
      }
      workStart = normalizeTimeToHHmm(workStart, "09:15");

      if (dayOfWeek === 5 || dayOfWeek === 6) {
        manualStatus = "overtime";
      } else {
        // 🚀 LATE CALCULATION FIX:
        // Use string comparison (HH:mm) in the same timezone (Script Timezone) 
        // to avoid offset issues with Date objects.
        var checkInTimeStr = Utilities.formatDate(checkInDate, Session.getScriptTimeZone(), "HH:mm");
        manualStatus = (checkInTimeStr > workStart) ? "late" : "present";
      }
      var transportContext = buildTransportContext();
      var attendanceTransport = resolveTransportPrice(site.transportPrice, data.employeeId, site.id, transportContext);

      sheet.appendRow([
        data.employeeId,data.employeeName,
        site.id,site.name,
        data.checkIn,"",
        data.latitude,data.longitude,
        manualStatus,"",
        attendanceTransport
      ]);

      var siteTransportLabel = attendanceTransport;
      return json({success:true, message: "تم تسجيل الحضور بنجاح في: " + site.name + (siteTransportLabel ? " (بدل انتقال: " + siteTransportLabel + ")" : "")});
    }

// CHECK-OUT
    if (data.action === "checkoutAttendance") {
      validateAll(ss, data);

      var sheet = getOrCreateSheet("attendance",
        ["employeeId","employeeName","siteId","siteName",
         "checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]
      );

      var rows = sheet.getDataRange().getValues();

      for (var i=rows.length-1;i>=1;i--) {
        if (rows[i][0]==data.employeeId && (rows[i][5] === "" || !rows[i][5])) {
          var checkOutDate = new Date(data.checkOut);
          var checkInDate = new Date(rows[i][4]);
          var hours = ((checkOutDate - checkInDate) / 36e5).toFixed(2);

          sheet.getRange(i+1,6).setValue(data.checkOut);
          sheet.getRange(i+1,10).setValue(hours);

          return json({success:true, message: "تم تسجيل الانصراف وإجمالي الساعات: " + hours});
        }
      }

      throw new Error("لا يوجد عملية حضور مفتوحة لنسجل الانصراف");
    }

  } catch(e){
    return json({success:false,message:e.toString().replace('Error: ', '')});
  }
}

/////////////////////////////
// 🔥 AUTOMATED REPORTS
/////////////////////////////

function sendDailyReport() {
  var settings = getSettingsObject();
  if (settings.dailyReportEnabled !== "true") return;
  
  var emails = settings.reportEmails;
  if (!emails) return;

  var today = new Date();
  var start = new Date(today);
  start.setHours(0,0,0,0);
  var end = new Date(today);
  end.setHours(23,59,59,999);

  var records = getAttendanceInRange(start, end);
  if (records.length === 0) return;

  var htmlTable = generateHTMLTable(records, "تقرير الحضور اليومي - " + today.toLocaleDateString('ar-EG'));

  var title = "تقرير الحضور اليومي - " + today.toLocaleDateString('ar-EG');
  GmailApp.sendEmail(emails, title, 
    "مرفق تقرير الحضور اليومي بصيغة Excel الاحترافية.", {
    htmlBody: htmlTable,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });
}

function sendManualReport(ss, data) {
  var settings = getSettingsObject();
  var emails = settings.reportEmails;
  if (!emails) throw new Error("يرجى إعداد إيميلات الاستلام في الإعدادات أولاً");

  var start = new Date(data.startDate);
  start.setHours(0,0,0,0);
  var end = new Date(data.endDate);
  end.setHours(23,59,59,999);

  var records = getAttendanceInRange(start, end);
  if (records.length === 0) return json({success:false, message: "لا توجد سجلات في هذه الفترة"});

  var title = "تقرير حضور مخصص: " + start.toLocaleDateString('ar-EG') + " إلى " + end.toLocaleDateString('ar-EG');
  var htmlTable = generateHTMLTable(records, title);

  GmailApp.sendEmail(emails, title, 
    "مرفق التقرير المخصص بصيغة Excel الاحترافية.", {
    htmlBody: htmlTable,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });

  return json({success:true});
}

function sendEmployeeDetailedReport(data) {
  if (!data.employeeId) throw new Error("يرجى اختيار الموظف");
  if (!data.startDate || !data.endDate) throw new Error("يرجى تحديد الفترة الزمنية");

  var start = new Date(data.startDate);
  start.setHours(0, 0, 0, 0);
  var end = new Date(data.endDate);
  end.setHours(23, 59, 59, 999);
  if (start > end) throw new Error("تاريخ البداية يجب أن يكون قبل تاريخ النهاية");

  var settings = getSettingsObject();
  var emails = (data.email || "").toString().trim();
  if (!emails) emails = (settings.reportEmails || "").toString().trim();
  if (!emails) throw new Error("يرجى إدخال بريد الإرسال أو ضبط إيميلات التقارير من الإعدادات");

  var records = getAttendanceInRange(start, end).filter(function(r) {
    return String(r.employeeId) === String(data.employeeId);
  });

  if (records.length === 0) {
    return json({ success: false, message: "لا توجد عمليات لهذا الموظف ضمن الفترة المحددة" });
  }

  var employeeName = (data.employeeName || records[0].employeeName || data.employeeId || "").toString();
  var stats = calculateEmployeeDetailedStats(records, start, end);
  var title = "التقرير التفصيلي للموظف: " + employeeName + " | " + start.toLocaleDateString('ar-EG') + " - " + end.toLocaleDateString('ar-EG');
  var htmlBody = generateEmployeeDetailedHTML(records, title, employeeName, stats, start, end);

  GmailApp.sendEmail(emails, title,
    "مرفق التقرير التفصيلي للموظف بصيغة Excel.", {
    htmlBody: htmlBody,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });

  return json({ success: true, message: "تم إرسال التقرير التفصيلي بنجاح" });
}

function getWorkingDaysCountInRange(startDate, endDate) {
  var count = 0;
  var tempDate = new Date(startDate);
  tempDate.setHours(0, 0, 0, 0);
  var finalDate = new Date(endDate);
  finalDate.setHours(23, 59, 59, 999);

  while (tempDate <= finalDate) {
    if (tempDate.getDay() !== 5 && tempDate.getDay() !== 6) count++;
    tempDate.setDate(tempDate.getDate() + 1);
  }
  return count;
}

function getRecordDateKey(value) {
  var d = new Date(value);
  if (isNaN(d)) return null;
  return d.toDateString();
}

function calculateUniqueDailyTransportTotal(records) {
  var dailyTransportByEmployee = {};

  records.forEach(function(r) {
    var dateKey = getRecordDateKey(r.checkIn);
    if (!dateKey) return;

    var employeeId = String(r.employeeId || "");
    var transport = toNumberSafe(r.transport, 0);
    var bucketKey = employeeId + "|" + dateKey;

    if (typeof dailyTransportByEmployee[bucketKey] === "undefined") {
      dailyTransportByEmployee[bucketKey] = transport;
    } else {
      dailyTransportByEmployee[bucketKey] = Math.max(dailyTransportByEmployee[bucketKey], transport);
    }
  });

  var total = 0;
  for (var key in dailyTransportByEmployee) {
    if (Object.prototype.hasOwnProperty.call(dailyTransportByEmployee, key)) {
      total += toNumberSafe(dailyTransportByEmployee[key], 0);
    }
  }
  return total;
}

function calculateEmployeeDetailedStats(records, startDate, endDate) {
  var presentDates = {};
  var lateDates = {};
  var totalHours = 0;
  var totalTransport = calculateUniqueDailyTransportTotal(records);

  records.forEach(function(r) {
    var checkInDate = new Date(r.checkIn);
    if (!isNaN(checkInDate)) {
      var dateKey = checkInDate.toDateString();
      presentDates[dateKey] = true;
      if (r.status === "late") lateDates[dateKey] = true;
    }

    var parsedHours = parseFloat(r.hours || 0);
    if (!isNaN(parsedHours)) totalHours += parsedHours;

  });

  var daysPresent = Object.keys(presentDates).length;
  var lateDays = Object.keys(lateDates).length;
  var workingDays = getWorkingDaysCountInRange(startDate, endDate);

  return {
    daysPresent: daysPresent,
    daysAbsent: Math.max(workingDays - daysPresent, 0),
    lateDays: lateDays,
    totalHours: totalHours,
    totalTransport: totalTransport,
    operationsCount: records.length
  };
}

function generateEmployeeDetailedHTML(records, title, employeeName, stats, startDate, endDate) {
  var sorted = records.slice().sort(function(a, b) {
    return new Date(b.checkIn) - new Date(a.checkIn);
  });

  var rows = sorted.map(function(r) {
    var checkInDate = r.checkIn ? new Date(r.checkIn) : null;
    var dateText = (checkInDate && !isNaN(checkInDate)) ? checkInDate.toLocaleDateString('ar-EG') : "-";
    var checkInText = (checkInDate && !isNaN(checkInDate))
      ? checkInDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      : "-";

    var checkOutText = "لم ينصرف بعد";
    if (r.checkOut) {
      var checkOutDate = new Date(r.checkOut);
      checkOutText = (!isNaN(checkOutDate))
        ? checkOutDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        : r.checkOut;
    }

    var statusText = "حاضر";
    var statusColor = "#10b981";
    if (r.status === "late") {
      statusText = "متأخر";
      statusColor = "#ef4444";
    } else if (r.status === "overtime") {
      statusText = "عمل إضافي";
      statusColor = "#3b82f6";
    }

    var parsedHours = parseFloat(r.hours);
    var hoursText = isNaN(parsedHours) ? "-" : parsedHours.toFixed(2);
    var parsedTransport = parseFloat(r.transport || 0);
    var transportText = (isNaN(parsedTransport) ? 0 : parsedTransport).toFixed(2);

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;">${dateText}</td>
        <td style="padding:10px 8px;">${r.siteName || "-"}</td>
        <td style="padding:10px 8px;" dir="ltr">${checkInText}</td>
        <td style="padding:10px 8px;" dir="ltr">${checkOutText}</td>
        <td style="padding:10px 8px;"><span style="background:${statusColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:0.75rem;">${statusText}</span></td>
        <td style="padding:10px 8px;">${hoursText}</td>
        <td style="padding:10px 8px;">${transportText} ج.م</td>
      </tr>
    `;
  }).join("");

  return `
    <div dir="rtl" style="font-family:'Tajawal','Segoe UI',Tahoma,sans-serif;background:#f8fafc;padding:20px;">
      <div style="max-width:900px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px;color:#fff;">
          <h2 style="margin:0 0 8px 0;">${title}</h2>
          <div style="opacity:0.9;">الموظف: ${employeeName} | الفترة: ${startDate.toLocaleDateString('ar-EG')} - ${endDate.toLocaleDateString('ar-EG')}</div>
        </div>

        <div style="padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.8rem;color:#64748b;">أيام الحضور</div>
            <div style="font-size:1.4rem;font-weight:700;color:#1e293b;">${stats.daysPresent}</div>
          </div>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.8rem;color:#991b1b;">أيام الغياب</div>
            <div style="font-size:1.4rem;font-weight:700;color:#dc2626;">${stats.daysAbsent}</div>
          </div>
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.8rem;color:#9a3412;">أيام التأخير</div>
            <div style="font-size:1.4rem;font-weight:700;color:#ea580c;">${stats.lateDays}</div>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.8rem;color:#1d4ed8;">إجمالي الساعات</div>
            <div style="font-size:1.4rem;font-weight:700;color:#2563eb;">${stats.totalHours.toFixed(2)}</div>
          </div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px;text-align:center;">
            <div style="font-size:0.8rem;color:#166534;">إجمالي البدلات</div>
            <div style="font-size:1.4rem;font-weight:700;color:#16a34a;">${stats.totalTransport.toFixed(2)} ج.م</div>
          </div>
        </div>

        <div style="padding:0 16px 16px 16px;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#f1f5f9;border-bottom:2px solid #e2e8f0;">
                <th style="padding:10px 8px;text-align:right;">التاريخ</th>
                <th style="padding:10px 8px;text-align:right;">الموقع</th>
                <th style="padding:10px 8px;text-align:right;">وقت الحضور</th>
                <th style="padding:10px 8px;text-align:right;">وقت الانصراف</th>
                <th style="padding:10px 8px;text-align:right;">الحالة</th>
                <th style="padding:10px 8px;text-align:right;">الساعات</th>
                <th style="padding:10px 8px;text-align:right;">البدل</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function sendMonthlyReport() {
  var settings = getSettingsObject();
  if (settings.monthlyReportEnabled !== "true") return;
  
  var emails = settings.reportEmails;
  if (!emails) return;

  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), 1);
  var end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  var records = getAttendanceInRange(start, end);
  if (records.length === 0) return;

  var title = "التقرير الشهري الشامل - " + (now.getMonth() + 1) + "/" + now.getFullYear();
  var htmlTable = generateHTMLTable(records, title);

  GmailApp.sendEmail(emails, title, 
    "مرفق التقرير الشهري الشامل بصيغة Excel الاحترافية.", {
    htmlBody: htmlTable,
    attachments: [generateStyledExcel(records, title)],
    name: "نظام الموارد البشرية"
  });
}

function getSettingsObject() {
  var s = getOrCreateSheet("settings", ["key", "value"]);
  var rows = s.getDataRange().getValues();
  var obj = {};
  for(var i=1; i<rows.length; i++) obj[rows[i][0]] = rows[i][1];
  return obj;
}

/////////////////////////////
// 🔥 PERMISSIONS INITIALIZER
// (Run this once manually if you get 'Permission denied')
/////////////////////////////
function initializePermissions() {
  // Touching these services forces GAS to ask for authorization
  try {
    DriveApp.getRootFolder();
    DriveApp.getStorageUsed();
    GmailApp.getAliases();
    SpreadsheetApp.getActive();
    UrlFetchApp.getRequest("https://www.google.com");
    console.log("✅ All permissions requested. Please follow the popup instructions.");
    return "تم تفعيل كافة الصلاحيات بنجاح.";
  } catch(e) {
    console.error(e);
    return "فشل تفعيل الصلاحيات: " + e.toString();
  }
}

function getAttendanceInRange(start, end) {
  var s = getOrCreateSheet("attendance", ["employeeId","employeeName","siteId","siteName","checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]);
  var data = s.getDataRange().getValues();
  data.shift();
  var transportContext = buildTransportContext();
  
  return data.filter(function(r) {
    var d = new Date(r[4]);
    return d >= start && d <= end;
  }).map(function(r) {
    var transport = resolveTransportPrice(r[10], r[0], r[2], transportContext);
    return {
      employeeId: r[0], employeeName: r[1], siteName: r[3], checkIn: r[4], checkOut: r[5], status: r[8], hours: r[9], transport: transport
    };
  });
}

function generateStyledExcel(records, reportTitle) {
  var ss;
  try {
    // 1. Create the temporary spreadsheet
    ss = SpreadsheetApp.create("temp_report_" + new Date().getTime());
    var sheet = ss.getSheets()[0];
    
    // Headers & Styling
    var headers = ["اسم الموظف (Name)", "الموقع (Site)", "تاريخ ووقت الحضور", "تاريخ ووقت الانصراف", "الحالة (Status)", "إجمالي الساعات", "بدل الانتقال (EGP)"];
    sheet.appendRow([reportTitle]);
    sheet.getRange("A1:G1").merge().setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center").setBackground("#4f46e5").setFontColor("#ffffff");
    sheet.appendRow(headers);
    sheet.getRange("A2:G2").setBackground("#f1f5f9").setFontWeight("bold").setHorizontalAlignment("center").setBorder(true, true, true, true, true, true);
    
    var totalTransport = calculateUniqueDailyTransportTotal(records);
    records.forEach(function(r) {
      sheet.appendRow([
        r.employeeName,
        r.siteName,
        r.checkIn ? new Date(r.checkIn) : "-",
        r.checkOut ? new Date(r.checkOut) : "-",
        r.status || "present",
        r.hours || "0",
        r.transport || "0"
      ]);
    });
    
    var lastRow = sheet.getLastRow();
    if (lastRow > 2) {
      sheet.getRange(3, 1, lastRow - 2, 7).setBorder(true, true, true, true, true, true).setHorizontalAlignment("center");
      for (var i = 3; i <= lastRow; i++) if (i % 2 === 0) sheet.getRange(i, 1, 1, 7).setBackground("#f8fafc");
    }
    sheet.appendRow(["", "", "", "", "", "الإجمالي:", totalTransport + " ج.م"]);
    sheet.getRange(sheet.getLastRow(), 6, 1, 2).setFontWeight("bold").setBackground("#f0fdf4").setFontColor("#166534");
    sheet.setColumnWidths(1, 1, 150);
    sheet.setColumnWidths(2, 6, 120);
    sheet.setRightToLeft(true);
    SpreadsheetApp.flush();
    
    // 2. 🚀 THE FIX: Correctly export as a real XLSX file using the export URL
    var url = "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=xlsx";
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    
    var blob = res.getBlob().setName(reportTitle + ".xlsx");
    
    // Cleanup the temp sheet
    try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch(trashErr) {}
    
    return blob;

  } catch(e) {
    console.error("XLSX Export failed:", e);
    // Final safety cleanup 
    if (ss) { try { DriveApp.getFileById(ss.getId()).setTrashed(true); } catch(t) {} }
    
    // 🚀 FALLBACK: Generate professional CSV if Excel/Drive/URL Fetch fails
    var BOM = "\uFEFF"; 
    var csvHeaders = ["الاسم", "الموقع", "الحضور", "الانصراف", "الحالة", "الساعات", "البدل"];
    var csvLines = [csvHeaders.join(",")];
    records.forEach(function(r) {
      var row = [
        '"' + r.employeeName + '"',
        '"' + r.siteName + '"',
        '"' + (r.checkIn ? new Date(r.checkIn).toLocaleString('ar-EG') : "-") + '"',
        '"' + (r.checkOut ? new Date(r.checkOut).toLocaleString('ar-EG') : "-") + '"',
        '"' + (r.status || "حاضر") + '"',
        '"' + (r.hours || "0") + '"',
        '"' + (r.transport || "0") + '"'
      ];
      csvLines.push(row.join(","));
    });
    return Utilities.newBlob(BOM + csvLines.join("\n"), 'text/csv', reportTitle + ".csv");
  }
}

function generateHTMLTable(records, title) {
  var totalTransport = calculateUniqueDailyTransportTotal(records);
  var totalHours = 0;
  var uniqueEmployees = new Set();
  var totalLates = 0;

  var rows = records.map(function(r) {
    totalHours += parseFloat(r.hours || 0);
    uniqueEmployees.add(r.employeeId);
    if(r.status === 'late') totalLates++;

    var statusColor = "#10b981"; // success
    var statusText = "حاضر";
    if(r.status === 'late') { statusColor = "#ef4444"; statusText = "متأخر"; }
    else if(r.status === 'overtime') { statusColor = "#3b82f6"; statusText = "إضافي"; }

    var checkInStr = r.checkIn ? new Date(r.checkIn).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : "-";
    var checkOutStr = r.checkOut ? new Date(r.checkOut).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : "-";

    return `
      <tr style="border-bottom: 1px solid #edf2f7;">
        <td style="padding: 14px 8px; color: #111827; font-weight: 600; font-size: 0.95rem;">${r.employeeName}</td>
        <td style="padding: 14px 8px; color: #374151; font-size: 0.9rem;">${r.siteName}</td>
        <td style="padding: 14px 8px; color: #374151; font-size: 0.85rem;" dir="ltr">
          <div style="font-weight: bold; color: #059669;">↓ ${checkInStr}</div>
          <div style="color: #6b7280; margin-top: 2px;">↑ ${checkOutStr}</div>
        </td>
        <td style="padding: 14px 8px; text-align: center;">
          <span style="background-color: ${statusColor}; color: white; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: bold; white-space: nowrap;">${statusText}</span>
        </td>
        <td style="padding: 14px 8px; color: #111827; font-weight: 800; text-align: left;">${parseFloat(r.transport || 0).toFixed(0)} <span style="font-size: 0.7rem; color: #6b7280;">ج.م</span></td>
      </tr>
    `;
  }).join("");

  return `
    <div dir="rtl" style="font-family: 'Tajawal', 'Segoe UI', Tahoma, sans-serif; max-width: 650px; margin: 0 auto; background-color: #f9fafb; padding: 15px; border-radius: 0;">
      
      <div style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e5e7eb;">
        
        <!-- Header Section -->
        <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 30px 20px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.025em;">${title}</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 1rem;">نظام إدارة الموارد البشرية والتقارير الذكية</p>
        </div>

        <!-- Summary Statistics -->
        <div style="padding: 20px; display: grid; gap: 12px; grid-template-columns: 1fr 1fr;">
          <div style="background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; text-align: center;">
            <div style="font-size: 0.8rem; color: #64748b; font-weight: 600; margin-bottom: 4px;">إجمالي الموظفين</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #4f46e5;">${uniqueEmployees.size}</div>
          </div>
          <div style="background: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; text-align: center;">
            <div style="font-size: 0.8rem; color: #64748b; font-weight: 600; margin-bottom: 4px;">ساعات العمل</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #4f46e5;">${totalHours.toFixed(1)}</div>
          </div>
          <div style="background: #fff1f2; padding: 15px; border-radius: 12px; border: 1px solid #fecdd3; text-align: center;">
            <div style="font-size: 0.8rem; color: #be123c; font-weight: 600; margin-bottom: 4px;">حالات التأخير</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #e11d48;">${totalLates}</div>
          </div>
          <div style="background: #f0fdf4; padding: 15px; border-radius: 12px; border: 1px solid #dcfce7; text-align: center;">
            <div style="font-size: 0.8rem; color: #15803d; font-weight: 600; margin-bottom: 4px;">إجمالي البدلات</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #16a34a;">${totalTransport.toFixed(0)} <span style="font-size: 0.8rem;">ج.م</span></div>
          </div>
        </div>

        <!-- Attendance Detail Table -->
        <div style="padding: 0 10px 20px 10px;">
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; min-width: 100%;">
              <thead>
                <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                  <th style="padding: 12px 8px; text-align: right; color: #475569; font-size: 0.85rem; font-weight: 700;">الموظف</th>
                  <th style="padding: 12px 8px; text-align: right; color: #475569; font-size: 0.85rem; font-weight: 700;">الموقع</th>
                  <th style="padding: 12px 8px; text-align: right; color: #475569; font-size: 0.85rem; font-weight: 700;">الوقت</th>
                  <th style="padding: 12px 8px; text-align: center; color: #475569; font-size: 0.85rem; font-weight: 700;">الحالة</th>
                  <th style="padding: 12px 8px; text-align: left; color: #475569; font-size: 0.85rem; font-weight: 700;">البدل</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; color: #6b7280; font-size: 0.8rem; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0;">هذا التقرير تم استخراجه آلياً. المرفق يحتوي على كامل التفاصيل بصيغة Excel.</p>
          <div style="margin-top: 10px;">
            <strong>نظام إدارة الموارد البشرية الاحترافي © 2026</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

function createTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  
  // Daily at 11 PM
  ScriptApp.newTrigger("sendDailyReport")
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .create();
    
  // Monthly on the 1st
  ScriptApp.newTrigger("sendMonthlyReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .create();
}

/////////////////////////////
// 🔥 JSON RESPONSE
/////////////////////////////
function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 🔥 DATA HELPERS (Optimized for reuse)

function _getEmployeesData(ss) {
  var s = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites","faceDescriptor","transportPrice"]);
  var d = s.getDataRange().getValues();
  d.shift();
  return d.map(function(r) { 
    var empId = String(r[0]);
    return {
      id: empId, 
      name: r[1], 
      email: r[2], 
      phone: r[4], 
      role: r[5], 
      assignedSites: r[6] ? r[6].toString().split(',') : [], 
      faceDescriptor: r[7], 
      transportPrice: toNumberSafe(r[8], 0),
      siteAllowances: getSiteAllowancesForEmployee(empId)
    };
  });
}

function _getSitesData(ss, employeeId) {
  var sitesSheet = getOrCreateSheet("sites", ["id","name","latitude","longitude","radius","transportPrice","mapLink"]);
  var sitesRows = sitesSheet.getDataRange().getValues();
  sitesRows.shift();
  var siteData = sitesRows.map(function(r) {
    return {
      id: String(r[0]),
      name: r[1],
      latitude: parseFloat(r[2]),
      longitude: parseFloat(r[3]),
      radius: toNumberSafe(r[4], 20),
      transportPrice: toNumberSafe(r[5], 0),
      mapLink: r[6] || "",
      isTemporary: false
    };
  });

  if (employeeId) {
    var empSheet = getOrCreateSheet("employees", ["id","name","email","password","phone","role","assignedSites"]);
    var empRows = empSheet.getDataRange().getValues();
    var assignedStr = "";
    for (var k = 1; k < empRows.length; k++) {
      if (String(empRows[k][0]) === String(employeeId)) {
        assignedStr = String(empRows[k][6] || "");
        break;
      }
    }
    if (assignedStr) {
      var assignedArray = assignedStr.split(',').map(function(s) { return s.trim(); });
      siteData = siteData.filter(function(s) { return assignedArray.indexOf(s.id) !== -1; });
    }
  }

  var reqSheet = getSiteRequestsSheet();
  var reqRows = reqSheet.getDataRange().getValues();
  reqRows.shift();
  for (var i = 0; i < reqRows.length; i++) {
    var req = reqRows[i];
    var isApprovedToday = isApprovedTodayRequestActive(req);
    var isAuto = false;
    if (String(req[SITE_REQUEST_COL.STATUS]) === "pending" && employeeId && String(req[SITE_REQUEST_COL.EMPLOYEE_ID]) === String(employeeId)) {
      var createdAt = new Date(req[SITE_REQUEST_COL.CREATED_AT]);
      if (!isNaN(createdAt.getTime()) && (new Date() - createdAt >= AUTO_APPROVAL_WAIT_MS)) isAuto = true;
    }
    if (!isApprovedToday && !isAuto) continue;
    if (employeeId && String(req[SITE_REQUEST_COL.EMPLOYEE_ID]) !== String(employeeId)) continue;
    siteData.push({
      id: String(req[SITE_REQUEST_COL.ID]),
      name: (isAuto ? "[موافقة تلقائية] " : "") + req[SITE_REQUEST_COL.SUGGESTED_NAME],
      latitude: parseFloat(req[SITE_REQUEST_COL.LATITUDE]),
      longitude: parseFloat(req[SITE_REQUEST_COL.LONGITUDE]),
      radius: isAuto ? AUTO_APPROVAL_MAX_DISTANCE_METERS : toNumberSafe(req[SITE_REQUEST_COL.TEMP_RADIUS], 100),
      transportPrice: toNumberSafe(req[SITE_REQUEST_COL.TRANSPORT_PRICE], 120),
      isTemporary: true,
      temporaryForEmployeeId: String(req[SITE_REQUEST_COL.EMPLOYEE_ID]),
      approvedAt: req[SITE_REQUEST_COL.APPROVED_AT] || "",
      approvalMode: isAuto ? "auto" : "today"
    });
  }
  return siteData;
}

function _getAttendanceData(ss, employeeId) {
  var s = getOrCreateSheet("attendance", ["employeeId","employeeName","siteId","siteName","checkIn","checkOut","latitude","longitude","status","totalHours","transportPrice"]);
  var d = s.getDataRange().getValues();
  d.shift();
  var transportContext = buildTransportContext();
  var records = d.map(function(r) {
    var hoursNum = toNumberSafe(r[9], null);
    if ((hoursNum === null || hoursNum === 0) && r[4] && r[5]) {
       try {
         var cIn = new Date(r[4]);
         var cOut = new Date(r[5]);
         if (!isNaN(cIn.getTime()) && !isNaN(cOut.getTime())) hoursNum = parseFloat(((cOut - cIn) / 36e5).toFixed(2));
       } catch(e) { hoursNum = 0; }
    }
    return {
      employeeId:r[0], employeeName:r[1], siteId:r[2], siteName:r[3],
      checkIn:r[4], checkOut:r[5], latitude:r[6], longitude:r[7], status:r[8], 
      totalHours: hoursNum || 0, transportPrice: resolveTransportPrice(r[10], r[0], r[2], transportContext)
    };
  });
  if (employeeId) records = records.filter(function(r) { return String(r.employeeId) === String(employeeId); });
  return records;
}

function _getSettingsData(ss) {
  var s = getOrCreateSheet("settings", ["key", "value"]);
  var rows = s.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < rows.length; i++) settings[rows[i][0]] = s.getRange(i + 1, 2).getDisplayValue();
  if (!settings.workStartTime) settings.workStartTime = "09:00";
  if (!settings.workEndTime) settings.workEndTime = "17:00";
  return settings;
}

function _getSiteRequestsData(ss) {
  var s = getSiteRequestsSheet();
  var d = s.getDataRange().getValues();
  d.shift();
  return d.map(function(r) {
    return {
      id: r[SITE_REQUEST_COL.ID],
      employeeId: r[SITE_REQUEST_COL.EMPLOYEE_ID],
      employeeName: r[SITE_REQUEST_COL.EMPLOYEE_NAME],
      latitude: r[SITE_REQUEST_COL.LATITUDE],
      longitude: r[SITE_REQUEST_COL.LONGITUDE],
      suggestedName: r[SITE_REQUEST_COL.SUGGESTED_NAME],
      mapLink: r[SITE_REQUEST_COL.MAP_LINK],
      status: r[SITE_REQUEST_COL.STATUS],
      timestamp: r[SITE_REQUEST_COL.CREATED_AT],
      transportPrice: toNumberSafe(r[SITE_REQUEST_COL.TRANSPORT_PRICE], 0),
      note: String(r[SITE_REQUEST_COL.NOTE] || ""),
      receiptUrl: String(r[SITE_REQUEST_COL.RECEIPT_URL] || ""),
      receiptName: String(r[SITE_REQUEST_COL.RECEIPT_NAME] || ""),
      tempRadius: toNumberSafe(r[SITE_REQUEST_COL.TEMP_RADIUS], 100),
      approvedAt: r[SITE_REQUEST_COL.APPROVED_AT] || "",
      mapLatitude: toNumberSafe(r[SITE_REQUEST_COL.MAP_LATITUDE], null),
      mapLongitude: toNumberSafe(r[SITE_REQUEST_COL.MAP_LONGITUDE], null),
      autoMeta: String(r[SITE_REQUEST_COL.AUTO_META] || ""),
      isAutoApproved: String(r[SITE_REQUEST_COL.AUTO_META] || "") === AUTO_APPROVAL_META,
      isActiveToday: isApprovedTodayRequestActive(r)
    };
  });
}
