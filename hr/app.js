const API_URL = '/api/exec';
// const OLD_BACKUP_API = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let hrSession = null;
let allAttendanceData = [];
let allEmployees = [];
let allSites = [];
let allSiteRequests = [];
let allAllowanceRequests = [];
let allLeaveRequests = [];
let appSettings = {};
let allOfficialHolidays = [];
let latesChartInstance = null;
let attendanceViewMode = 'present'; // 'present' or 'absent'
let parseMapLinkTimer = null;
let parseMapLinkRequestId = 0;
let isInitialDataLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
    // Set default dates
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    
    document.getElementById('attendanceDateFilter').value = todayStr;
    document.getElementById('reportStartDate').value = firstDayOfMonth;
    document.getElementById('reportEndDate').value = todayStr;
    document.getElementById('employeeReportStartDate').value = firstDayOfMonth;
    document.getElementById('employeeReportEndDate').value = todayStr;
    
    checkSession();
});

function checkSession() {
    const userJson = localStorage.getItem('hrSession');
    if (userJson) {
        hrSession = JSON.parse(userJson);
        document.getElementById('hrLoginSection').classList.add('hidden');
        document.getElementById('dashboardSection').classList.remove('hidden');
        initDashboard();
        
        // Restore active tab
        const savedTab = localStorage.getItem('hrActiveTab');
        if (savedTab) {
            showTab(savedTab);
        }
    }
}

async function loginHR() {
    const email = document.getElementById('hrIdentifier').value.trim();
    const pass = document.getElementById('hrPass').value.trim();
    if (!email || !pass) return;

    const btn = document.querySelector('#hrLoginSection .auth-form button');
    if (btn) btn.innerText = 'جاري التحقق...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', identifier: email, password: pass, role: 'hr' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('hrSession', JSON.stringify(result.data));
            checkSession();
        } else {
            document.getElementById('loginError').innerText = result.message || 'خطأ في بيانات الدخول أو لا تملك صلاحيات HR';
            document.getElementById('loginError').classList.remove('hidden');
        }
    } catch (e) {
        document.getElementById('loginError').innerText = 'فشل الاتصال بالخادم: ' + e.message;
        document.getElementById('loginError').classList.remove('hidden');
        console.error(e);
    }
    if (btn) btn.innerText = 'دخول';
}

function logout() {
    localStorage.removeItem('hrSession');
    location.reload();
}

function showTab(tabName) {
    // Hide all tabs and reset active states
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    // Show target tab
    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) {
        targetTab.classList.remove('hidden');
        // Scroll to top of main content
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollTop = 0;
    }

    // Highlight the active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        const onclickAttr = link.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(`'${tabName}'`)) {
            link.classList.add('active');
        }
    });

    // Save active tab
    localStorage.setItem('hrActiveTab', tabName);

    // Reset loader state before fetching new data
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');

    // Fetch data for the active tab
    if (tabName === 'attendance') fetchAttendance();
    if (tabName === 'employees') fetchEmployees();
    if (tabName === 'sites') fetchSites();
    if (tabName === 'siteRequests') fetchSiteRequests();
    if (tabName === 'allowanceRequests') fetchAllowanceRequests();
    if (tabName === 'reports') generateReport();
    if (tabName === 'employeeDetails') initEmployeeDetailedTab();
    if (tabName === 'settings') fetchSettings();
    if (tabName === 'officialHolidays') fetchOfficialHolidays();
    if (tabName === 'leaveRequests') fetchLeaveRequests();
    if (tabName === 'deviceManagement') {
        // Non-blocking fetch to improve INP
        setTimeout(() => {
            Promise.all([fetchDeviceChangeRequests(), fetchAllDevices()]);
        }, 0);
    }

    // Close sidebar on mobile after clicking a link
    const sidebar = document.querySelector('.sidebar');
    if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('active')) {
        toggleSidebar();
    }
}

async function initDashboard(forceRefresh = false) {
    if (isInitialDataLoaded && !forceRefresh) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        // Fetch dashboard data and official holidays in parallel
        const [dashboardRes, holidaysRes] = await Promise.all([
            fetch(`${API_URL}?action=getDashboardData`),
            fetch(`${API_URL}?action=getOfficialHolidays`)
        ]);

        const result = await dashboardRes.json();
        const holidaysResult = await holidaysRes.json();

        if (result.success) {
            allAttendanceData = result.attendance || [];
            allEmployees = result.employees || [];
            allSites = result.sites || [];
            allSiteRequests = result.siteRequests || [];
            allAllowanceRequests = result.allowanceRequests || [];
            allLeaveRequests = result.leaveRequests || [];
            appSettings = result.settings || {};

            // Load official holidays
            if (holidaysResult.success) {
                allOfficialHolidays = holidaysResult.data || [];
            }

            isInitialDataLoaded = true;

            // Render the current active tab
            const activeTab = localStorage.getItem('hrActiveTab') || 'attendance';
            renderActiveTab(activeTab);

            // Initialize notifications
            initNotifications();
        }
    } catch (e) {
        console.error("Initial load failed", e);
    }
    document.getElementById('loader').classList.add('hidden');
}

function renderActiveTab(tabName) {
    if (tabName === 'attendance') renderAttendanceTable(allAttendanceData);
    if (tabName === 'employees') renderEmployeesTable(allEmployees);
    if (tabName === 'sites') renderSitesTable(allSites);
    if (tabName === 'siteRequests') renderRequestsTable(allSiteRequests);
    if (tabName === 'allowanceRequests') renderAllowanceRequestsTable(allAllowanceRequests);
    if (tabName === 'leaveRequests') renderLeaveRequestsTable(allLeaveRequests);
    if (tabName === 'settings') renderSettings(appSettings);
    if (tabName === 'deviceManagement') {
        setTimeout(() => {
            Promise.all([fetchDeviceChangeRequests(), fetchAllDevices()]);
        }, 0);
    }
}

async function fetchAttendance(force = false) {
    if (!force && allAttendanceData.length) {
        renderAttendanceTable(allAttendanceData);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getAttendance`);
        const result = await res.json();
        if(result.success) {
            allAttendanceData = result.data;
            renderAttendanceTable(allAttendanceData);
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

async function refreshData() {
    await initDashboard(true);
}

// Helper: Extract Cairo time from ISO string (format: 2026-04-26T09:34:48+02:00)
// Returns time in format "9:34:48 ص" without any timezone conversion
function formatCairoTime(isoString) {
    if (!isoString) return '-';
    // Match the time part before the timezone offset: T09:34:48+02:00 -> 09:34:48
    const match = isoString.match(/T(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return isoString;
    
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const seconds = match[3];
    
    // Convert to 12-hour format with AM/PM
    const period = hours >= 12 ? 'م' : 'ص';
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    
    return `${hours}:${minutes}:${seconds} ${period}`;
}

// Helper: Extract Cairo date from ISO string
function formatCairoDate(isoString) {
    if (!isoString) return '-';
    const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return isoString;
    return `${parseInt(match[3], 10)}/${parseInt(match[2], 10)}/${match[1]}`;
}

function formatDate(isoString) {
    return formatCairoDate(isoString);
}

function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function renderAttendanceTable(data) {
    const filterDate = document.getElementById('attendanceDateFilter').value;
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';
    
    // Filter by date if selected
    let filtered = data;
    if (filterDate) {
        filtered = data.filter(record => {
            const recordDate = record.checkIn ? record.checkIn.slice(0, 10) : '';
            return recordDate === filterDate;
        });
    }

    // Calculate attendance stats (excluding HR employees)
    const employeeOnlyList = allEmployees.filter(e => e.role !== 'hr');
    const employeeOnlyIds = new Set(employeeOnlyList.map(e => String(e.id)));
    
    const presentEmployeeIds = new Set();
    filtered.forEach(record => {
        if (record.employeeId && employeeOnlyIds.has(String(record.employeeId))) {
            presentEmployeeIds.add(String(record.employeeId));
        }
    });
    const presentCount = presentEmployeeIds.size;
    const totalEmployees = employeeOnlyList.length;
    const absentCount = Math.max(0, totalEmployees - presentCount);

    // Update stats display
    const statPresent = document.getElementById('statPresent');
    const statAbsent = document.getElementById('statAbsent');
    if (statPresent) statPresent.innerText = presentCount;
    if (statAbsent) statAbsent.innerText = absentCount;

    // Show absent employees view
    if (attendanceViewMode === 'absent') {
        // Find absent employees
        const absentEmployees = employeeOnlyList.filter(emp => !presentEmployeeIds.has(String(emp.id)));
        
        absentEmployees.forEach(emp => {
            tbody.innerHTML += `
                <tr style="background:rgba(239,68,68,0.05);">
                    <td data-label="الموظف">${emp.name}</td>
                    <td data-label="الموقع">-</td>
                    <td data-label="وقت الحضور" dir="ltr">-</td>
                    <td data-label="وقت الانصراف" dir="ltr">-</td>
                    <td data-label="بدل الانتقال">-</td>
                    <td data-label="الحالة"><span style="color:var(--danger)">غائب</span></td>
                </tr>
            `;
        });
        return;
    }

    // Show present employees (default view)
    [...filtered].reverse().forEach(record => {
        // Display time as-is (server sends Cairo time with offset)
        const checkInTime = formatCairoTime(record.checkIn);
        const checkInDate = formatCairoDate(record.checkIn);

        let checkOutTime = 'لم ينصرف بعد';
        if (record.status === 'no_checkout') {
            checkOutTime = 'لم يتم الانصراف';
        } else if (record.checkOut) {
            checkOutTime = formatCairoTime(record.checkOut);
        }
        
        let statusText = 'حاضر';
        let statusColor = 'var(--secondary)';
        
        if (record.status === 'late') {
            statusText = 'متأخر';
            statusColor = 'var(--danger)';
        } else if (record.status === 'overtime') {
            statusText = 'عمل إضافي';
            statusColor = '#3b82f6';
        } else if (record.status === 'no_checkout') {
            statusText = 'لم يتم الانصراف';
            statusColor = '#f59e0b';
        }

        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${record.employeeName}</td>
                <td data-label="الموقع">${record.siteName}</td>
                <td data-label="وقت الحضور" dir="ltr">${checkInDate} ${checkInTime}</td>
                <td data-label="وقت الانصراف" dir="ltr">${checkOutTime}</td>
                <td data-label="بدل الانتقال">${getCurrentTransportPrice(record) || 0} ج.م</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
            </tr>
        `;
    });
}

function toggleAttendanceView() {
    attendanceViewMode = attendanceViewMode === 'present' ? 'absent' : 'present';
    const btn = document.getElementById('viewToggleBtn');
    if (attendanceViewMode === 'absent') {
        btn.innerText = '👁️ عرض الحاضرين';
        btn.style.background = 'var(--secondary)';
    } else {
        btn.innerText = '👁️ عرض الغائبين';
        btn.style.background = 'var(--danger)';
    }
    renderAttendanceTable(allAttendanceData);
}

function getWeekendDaysFromSettings() {
    // Default: Friday (5) and Saturday (6)
    const weekendDaysStr = appSettings.weekendDays || "5,6";
    return weekendDaysStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
}

function getWorkingDaysCount(startDate, endDate) {
    let workingDaysCount = 0;
    const tempDate = new Date(startDate);
    tempDate.setHours(0, 0, 0, 0);

    const finalDate = new Date(endDate);
    finalDate.setHours(23, 59, 59, 999);

    const weekendDays = getWeekendDaysFromSettings();

    // Build a Set of official holiday dates for quick lookup
    const holidayDates = new Set();
    allOfficialHolidays.forEach(h => {
        if (h.holidayDate) {
            const d = new Date(h.holidayDate);
            if (!isNaN(d)) {
                const dateKey = getLocalDateKey(d);
                holidayDates.add(dateKey);
            }
        }
    });

    while (tempDate <= finalDate) {
        const currentDateKey = getLocalDateKey(tempDate);
        const isWeekend = weekendDays.includes(tempDate.getDay());
        const isHoliday = holidayDates.has(currentDateKey);

        if (!isWeekend && !isHoliday) {
            workingDaysCount += 1;
        }
        tempDate.setDate(tempDate.getDate() + 1);
    }
    return workingDaysCount;
}

function toTransportNumber(value) {
    const parsed = parseFloat(value || 0);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function getCurrentTransportPrice(record) {
    const employee = allEmployees.find(e => String(e.id) === String(record.employeeId));
    const allowance = employee && employee.siteAllowances ? 
        employee.siteAllowances.find(a => String(a.siteId) === String(record.siteId)) : null;
    return allowance ? parseFloat(allowance.transportPrice || 0) : toTransportNumber(record.transportPrice);
}

function calculateUniqueDailyTransport(records) {
    const dailyTransport = {};
    records.forEach(record => {
        const dateStr = record.checkIn ? record.checkIn.slice(0, 10) : '';
        if (!dateStr) return;

        const dayKey = `${String(record.employeeId || '')}|${dateStr}`;
        const transportValue = getCurrentTransportPrice(record);

        if (!(dayKey in dailyTransport)) {
            dailyTransport[dayKey] = transportValue;
        } else if (transportValue > dailyTransport[dayKey]) {
            dailyTransport[dayKey] = transportValue;
        }
    });

    return Object.values(dailyTransport).reduce((sum, value) => sum + value, 0);
}

function getStatusMeta(status) {
    if (status === 'late') return { text: 'متأخر', color: 'var(--danger)' };
    if (status === 'overtime') return { text: 'عمل إضافي', color: '#3b82f6' };
    if (status === 'no_checkout') return { text: 'لم يتم الانصراف', color: '#f59e0b' };
    return { text: 'حاضر', color: 'var(--secondary)' };
}

function resetEmployeeDetailedReportView(message) {
    document.getElementById('employeeDetailPresent').innerText = '0';
    document.getElementById('employeeDetailAbsent').innerText = '0';
    document.getElementById('employeeDetailLate').innerText = '0';
    document.getElementById('employeeDetailOvertime').innerText = '0';
    document.getElementById('employeeDetailLeaveRequests').innerText = '0';
    document.getElementById('employeeDetailNoCheckout').innerText = '0';
    document.getElementById('employeeDetailOvertimePay').innerText = '0.00';
    document.getElementById('employeeDetailTransport').innerText = '0.00';
    document.getElementById('employeeDetailMeta').innerText = message || 'اختر موظفًا وحدد الفترة الزمنية ثم اضغط "عرض التقرير".';

    const tbody = document.getElementById('employeeDetailTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="employee-report-empty">لا توجد بيانات معروضة بعد.</td>
            </tr>
        `;
    }

    const leaveTbody = document.getElementById('employeeLeaveRequestsTableBody');
    if (leaveTbody) {
        leaveTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">لا توجد طلبات إجازة</td></tr>';
    }
}

function populateEmployeeDetailEmployees() {
    const select = document.getElementById('employeeDetailEmployee');
    if (!select) return;

    const currentValue = select.value;
    const sortedEmployees = [...allEmployees].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'ar')
    );

    select.innerHTML = '<option value="">اختر موظف</option>';
    sortedEmployees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.name} (${emp.id})`;
        select.appendChild(option);
    });

    if (currentValue && sortedEmployees.some(emp => String(emp.id) === String(currentValue))) {
        select.value = currentValue;
    }
}

async function initEmployeeDetailedTab() {
    if (!allEmployees.length) await fetchEmployees();
    if (!allAttendanceData.length) await fetchAttendance();
    populateEmployeeDetailEmployees();

    const selectedEmployee = document.getElementById('employeeDetailEmployee').value;
    if (selectedEmployee) {
        await generateEmployeeDetailedReport();
    } else {
        resetEmployeeDetailedReportView();
    }
}

async function generateEmployeeDetailedReport() {
    const employeeSelect = document.getElementById('employeeDetailEmployee');
    const employeeId = employeeSelect.value;
    const startStr = document.getElementById('employeeReportStartDate').value;
    const endStr = document.getElementById('employeeReportEndDate').value;

    if (!employeeId) return alert('يرجى اختيار الموظف أولًا');
    if (!startStr || !endStr) return alert('يرجى اختيار الفترة الزمنية أولًا');

    const startDate = new Date(startStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    if (startDate > endDate) return alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');

    if (!allAttendanceData.length) {
        await fetchAttendance();
    }

    const employeeRecords = allAttendanceData.filter(record => {
        const recordDateStr = record.checkIn ? record.checkIn.slice(0, 10) : '';
        if (!recordDateStr) return false;
        return String(record.employeeId) === String(employeeId) && recordDateStr >= startStr && recordDateStr <= endStr;
    });

    const sortedRecords = [...employeeRecords].sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
    const presentDates = new Set();
    const lateDates = new Set();
    const overtimeDates = new Set();
    const noCheckoutDates = new Set();
    let totalTransport = 0;

    sortedRecords.forEach(record => {
        const dateKey = record.checkIn ? record.checkIn.slice(0, 10) : null;
        if (dateKey) {
            // Determine if this is an overtime day (weekend/holiday work)
            const recordDateObj = new Date(dateKey);
            const dayOfWeek = recordDateObj.getDay();
            const weekendDays = getWeekendDaysFromSettings();
            const isWeekend = weekendDays.includes(dayOfWeek);
            const isOfficialHoliday = allOfficialHolidays.some(h => {
                if (!h.holidayDate) return false;
                const holidayDate = new Date(h.holidayDate);
                return holidayDate.toISOString().split('T')[0] === dateKey;
            });
            const isOvertimeDay = record.status === 'overtime' || ((isWeekend || isOfficialHoliday) && record.status !== 'late' && record.status !== 'present');

            // Count as present if not overtime
            if (!isOvertimeDay) {
                presentDates.add(dateKey);
            }
            if (record.status === 'late') lateDates.add(dateKey);
            if (isOvertimeDay) overtimeDates.add(dateKey);
            if (record.status === 'no_checkout') noCheckoutDates.add(dateKey);
        }
    });

    totalTransport = calculateUniqueDailyTransport(sortedRecords);

    const workingDaysCount = getWorkingDaysCount(startDate, endDate);
    const daysPresent = presentDates.size;
    const daysAbsent = Math.max(workingDaysCount - daysPresent, 0);

    // Calculate overtime pay based on employee salary
    const employee = allEmployees.find(e => String(e.id) === String(employeeId));
    const salary = employee ? parseFloat(employee.salary || 0) : 0;
    const overtimeDays = overtimeDates.size;
    const dailyRate = salary / 30;
    const overtimePay = dailyRate * overtimeDays;

    // Calculate leave requests for this employee in the date range
    const employeeLeaveRequests = allLeaveRequests.filter(req => {
        return String(req.employeeId) === String(employeeId) &&
               req.leaveDate >= startStr && req.leaveDate <= endStr;
    });
    const leaveRequestsCount = employeeLeaveRequests.length;

    document.getElementById('employeeDetailPresent').innerText = String(daysPresent);
    document.getElementById('employeeDetailAbsent').innerText = String(daysAbsent);
    document.getElementById('employeeDetailLate').innerText = String(lateDates.size);
    document.getElementById('employeeDetailOvertime').innerText = String(overtimeDays);
    document.getElementById('employeeDetailNoCheckout').innerText = String(noCheckoutDates.size);
    document.getElementById('employeeDetailLeaveRequests').innerText = String(leaveRequestsCount);
    document.getElementById('employeeDetailOvertimePay').innerText = overtimePay.toFixed(2);
    document.getElementById('employeeDetailTransport').innerText = totalTransport.toFixed(2);

    const selectedLabel = employeeSelect.options[employeeSelect.selectedIndex]
        ? employeeSelect.options[employeeSelect.selectedIndex].textContent
        : employeeId;
    const employeeName = selectedLabel.replace(/\s*\(.+\)\s*$/, '').trim() || selectedLabel;
    const startDateStr = formatCairoDate(startStr + 'T00:00:00+02:00');
    const endDateStr = formatCairoDate(endStr + 'T00:00:00+02:00');
    document.getElementById('employeeDetailMeta').innerText =
        `الموظف: ${employeeName} | الفترة: ${startDateStr} - ${endDateStr} | عدد العمليات: ${sortedRecords.length}`;

    const tbody = document.getElementById('employeeDetailTableBody');
    if (sortedRecords.length === 0 && daysAbsent === 0 && leaveRequestsCount === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="employee-report-empty">لا توجد عمليات لهذا الموظف خلال الفترة المحددة.</td>
            </tr>
        `;
        return;
    }

    // Map attendance records by date for easy lookup
    const attendanceByDate = {};
    sortedRecords.forEach(record => {
        const dateKey = record.checkIn ? record.checkIn.slice(0, 10) : '';
        if (dateKey) {
            if (!attendanceByDate[dateKey]) attendanceByDate[dateKey] = [];
            attendanceByDate[dateKey].push(record);
        }
    });

    // Map approved leave requests by date
    const approvedLeavesByDate = {};
    allLeaveRequests.filter(req => 
        String(req.employeeId) === String(employeeId) && 
        req.status === 'approved'
    ).forEach(req => {
        approvedLeavesByDate[req.leaveDate] = req;
    });

    const weekendDays = getWeekendDaysFromSettings();
    const holidayDates = new Set();
    allOfficialHolidays.forEach(h => {
        if (h.holidayDate) {
            const d = new Date(h.holidayDate);
            if (!isNaN(d)) holidayDates.add(getLocalDateKey(d));
        }
    });

    tbody.innerHTML = '';
    
    // Iterate from End Date back to Start Date
    let currentLoopDate = new Date(endDate);
    currentLoopDate.setHours(0, 0, 0, 0);
    const stopLoopDate = new Date(startDate);
    stopLoopDate.setHours(0, 0, 0, 0);

    while (currentLoopDate >= stopLoopDate) {
        const dateKey = getLocalDateKey(currentLoopDate);
        const displayDate = formatCairoDate(dateKey);
        
        if (attendanceByDate[dateKey]) {
            // Show attendance records (present, late, overtime, etc.)
            attendanceByDate[dateKey].forEach(record => {
                const checkInText = formatCairoTime(record.checkIn);
                let checkOutText = 'لم ينصرف بعد';
                if (record.status === 'no_checkout') {
                    checkOutText = 'لم يتم الانصراف';
                } else if (record.checkOut) {
                    checkOutText = formatCairoTime(record.checkOut);
                }
                const statusMeta = getStatusMeta(record.status);
                const currentTransport = getCurrentTransportPrice(record);
                
                tbody.innerHTML += `
                    <tr>
                        <td data-label="التاريخ">${displayDate}</td>
                        <td data-label="الموقع">${record.siteName || '-'}</td>
                        <td data-label="وقت الحضور" dir="ltr">${checkInText}</td>
                        <td data-label="وقت الانصراف" dir="ltr">${checkOutText}</td>
                        <td data-label="الحالة"><span style="color:${statusMeta.color}">${statusMeta.text}</span></td>
                        <td data-label="البدل">${currentTransport.toFixed(2)} ج.م</td>
                    </tr>
                `;
            });
        } else {
            // No attendance record for this day
            const isWeekend = weekendDays.includes(currentLoopDate.getDay());
            const isHoliday = holidayDates.has(dateKey);
            const leaveReq = approvedLeavesByDate[dateKey];

            if (leaveReq) {
                // Approved Leave
                tbody.innerHTML += `
                    <tr style="background:rgba(16,185,129,0.05);">
                        <td data-label="التاريخ">${displayDate}</td>
                        <td data-label="الموقع">-</td>
                        <td data-label="وقت الحضور">-</td>
                        <td data-label="وقت الانصراف">-</td>
                        <td data-label="الحالة"><span style="color:#10b981; font-weight:bold;">إجازة معتمدة</span></td>
                        <td data-label="البدل">0.00 ج.م</td>
                    </tr>
                `;
            } else if (!isWeekend && !isHoliday) {
                // Working day with no attendance and no leave -> Absent
                tbody.innerHTML += `
                    <tr style="background:rgba(239,68,68,0.05);">
                        <td data-label="التاريخ">${displayDate}</td>
                        <td data-label="الموقع">-</td>
                        <td data-label="وقت الحضور">-</td>
                        <td data-label="وقت الانصراف">-</td>
                        <td data-label="الحالة"><span style="color:var(--danger); font-weight:bold;">غائب</span></td>
                        <td data-label="البدل">0.00 ج.م</td>
                    </tr>
                `;
            }
            // Weekends and Holidays without attendance are not shown to keep the table clean
        }
        
        currentLoopDate.setDate(currentLoopDate.getDate() - 1);
    }

    // Render leave requests table
    const leaveTbody = document.getElementById('employeeLeaveRequestsTableBody');
    if (leaveTbody) {
        if (employeeLeaveRequests.length === 0) {
            leaveTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">لا توجد طلبات إجازة</td></tr>';
        } else {
            leaveTbody.innerHTML = '';
            // Sort by leave date
            const sortedLeaves = [...employeeLeaveRequests].sort((a, b) => new Date(a.leaveDate) - new Date(b.leaveDate));
            sortedLeaves.forEach(req => {
                let statusText = '';
                let statusColor = '';
                if (req.status === 'pending') {
                    statusText = 'قيد الانتظار';
                    statusColor = '#f59e0b';
                } else if (req.status === 'approved') {
                    statusText = 'تمت الموافقة';
                    statusColor = '#10b981';
                } else if (req.status === 'rejected') {
                    statusText = 'مرفوض';
                    statusColor = '#ef4444';
                }

                leaveTbody.innerHTML += `
                    <tr>
                        <td>${req.leaveDate}</td>
                        <td>${req.reason}</td>
                        <td>${formatDate(req.createdAt)}</td>
                        <td><span style="color:${statusColor}; font-weight:bold;">${statusText}</span></td>
                        <td>${req.approvedAt ? formatDate(req.approvedAt) : '-'}</td>
                    </tr>
                `;
            });
        }
    }
}

async function sendEmployeeDetailedReport() {
    const employeeSelect = document.getElementById('employeeDetailEmployee');
    const employeeId = employeeSelect.value;
    const startStr = document.getElementById('employeeReportStartDate').value;
    const endStr = document.getElementById('employeeReportEndDate').value;
    const customEmail = document.getElementById('employeeReportEmail').value.trim();

    if (!employeeId) return alert('يرجى اختيار الموظف أولًا');
    if (!startStr || !endStr) return alert('يرجى اختيار الفترة الزمنية أولًا');

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    if (startDate > endDate) return alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');

    const selectedLabel = employeeSelect.options[employeeSelect.selectedIndex]
        ? employeeSelect.options[employeeSelect.selectedIndex].textContent
        : employeeId;
    const employeeName = selectedLabel.replace(/\s*\(.+\)\s*$/, '').trim() || selectedLabel;

    const receiverText = customEmail ? `إلى: ${customEmail}` : 'إلى الإيميلات المسجلة في الإعدادات';
    if (!confirm(`هل تريد إرسال التقرير التفصيلي للموظف "${employeeName}" ${receiverText}؟`)) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'sendEmployeeDetailedReport',
                employeeId: employeeId,
                employeeName: employeeName,
                startDate: startStr,
                endDate: endStr,
                email: customEmail
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        alert(result.success ? (result.message || '✅ تم إرسال التقرير بنجاح') : `❌ فشل الإرسال: ${result.message}`);
    } catch (e) {
        console.error(e);
        alert('حدث خطأ في الاتصال أثناء إرسال التقرير');
    }
    document.getElementById('loader').classList.add('hidden');
}

// Reports Logic
function generateReport() {
    const startStr = document.getElementById('reportStartDate').value;
    const endStr = document.getElementById('reportEndDate').value;
    
    if(!startStr || !endStr || allAttendanceData.length === 0) return;
    
    const startDate = new Date(startStr);
    startDate.setHours(0,0,0,0);
    const endDate = new Date(endStr);
    endDate.setHours(23,59,59,999);

    // Filter records for the range (using Cairo-normalized dates)
    const filtered = allAttendanceData.filter(record => {
        const recordDateStr = record.checkIn ? record.checkIn.slice(0, 10) : '';
        return recordDateStr >= startStr && recordDateStr <= endStr;
    });

    const reportAcc = {};

    filtered.forEach(record => {
        const empId = record.employeeId;
        const recordDate = record.checkIn ? record.checkIn.slice(0, 10) : '';

        if(!reportAcc[empId]) {
             reportAcc[empId] = {
                 name: record.employeeName,
                 uniqueDates: new Set(),
                 lateDates: new Set(),
                 overtimeDates: new Set(),
                 noCheckoutDates: new Set(),
                 transportByDate: {},
                 daysPresent: 0,
                 lates: 0,
                 overtime: 0,
                 noCheckout: 0,
                 totalTransport: 0
             };
        }
        
        const empStats = reportAcc[empId];

        // Determine if this is an overtime day (weekend/holiday work)
        // A day is overtime if: status is 'overtime', OR it's a weekend/holiday with any attendance
        const recordDateObj = new Date(recordDate);
        const dayOfWeek = recordDateObj.getDay();
        const weekendDays = getWeekendDaysFromSettings();
        const isWeekend = weekendDays.includes(dayOfWeek);
        const isOfficialHoliday = allOfficialHolidays.some(h => {
            if (!h.holidayDate) return false;
            const holidayDate = new Date(h.holidayDate);
            return holidayDate.toISOString().split('T')[0] === recordDate;
        });
        const isOvertimeDay = record.status === 'overtime' || ((isWeekend || isOfficialHoliday) && record.status !== 'late' && record.status !== 'present');

        // Only count as regular attendance if not overtime
        if (!isOvertimeDay) {
            if (!empStats.uniqueDates.has(recordDate)) {
                empStats.uniqueDates.add(recordDate);
                empStats.daysPresent += 1;
            }
        }

        if(record.status === 'late') {
            if (!empStats.lateDates.has(recordDate)) {
                empStats.lateDates.add(recordDate);
                empStats.lates += 1;
            }
        }
        if(isOvertimeDay) {
            if (!empStats.overtimeDates.has(recordDate)) {
                empStats.overtimeDates.add(recordDate);
                empStats.overtime += 1;
            }
        }
        if(record.status === 'no_checkout') {
            if (!empStats.noCheckoutDates.has(recordDate)) {
                empStats.noCheckoutDates.add(recordDate);
                empStats.noCheckout += 1;
            }
        }
        // Get current transport price from siteAllowances (reflects latest changes)
        const employee = allEmployees.find(e => String(e.id) === String(empId));
        const allowance = employee && employee.siteAllowances ? 
            employee.siteAllowances.find(a => String(a.siteId) === String(record.siteId)) : null;
        const transportValue = allowance ? parseFloat(allowance.transportPrice || 0) : 
            toTransportNumber(record.transportPrice);
        
        if (!(recordDate in empStats.transportByDate)) {
            empStats.transportByDate[recordDate] = transportValue;
        } else if (transportValue > empStats.transportByDate[recordDate]) {
            empStats.transportByDate[recordDate] = transportValue;
        }
    });

    Object.keys(reportAcc).forEach(empId => {
        const map = reportAcc[empId].transportByDate;
        reportAcc[empId].totalTransport = Object.values(map).reduce((sum, value) => sum + value, 0);

        // Calculate overtime pay based on employee salary
        const employee = allEmployees.find(e => String(e.id) === String(empId));
        const salary = employee ? parseFloat(employee.salary || 0) : 0;
        const dailyRate = salary / 30;
        reportAcc[empId].overtimePay = dailyRate * reportAcc[empId].overtime;
    });

    // Calculate working days passed in the selected range
    const workingDaysCount = getWorkingDaysCount(startDate, endDate);

    let kpiTotalLates = 0;
    let kpiActiveEmp = Object.keys(reportAcc).length;

    const names = [];
    const lates = [];

    const tbody = document.getElementById('reportsTableBody');
    tbody.innerHTML = '';

    for (let empId in reportAcc) {
        const data = reportAcc[empId];
        kpiTotalLates += data.lates;
        
        const absentDays = workingDaysCount - data.daysPresent;
        
        names.push(data.name);
        lates.push(data.lates);

        tbody.innerHTML += `
            <tr>
                <td data-label="ID الموظف">${empId}</td>
                <td data-label="اسم الموظف">${data.name}</td>
                <td data-label="أيام الحضور">${data.daysPresent} أيام</td>
                <td data-label="أيام الغياب"><span style="color:${absentDays > 0 ? 'var(--danger)' : 'inherit'}">${absentDays > 0 ? absentDays : 0} أيام</span></td>
                <td data-label="التأخير"><span style="color:${data.lates > 0 ? 'var(--danger)' : 'inherit'}">${data.lates} مرات</span></td>
                <td data-label="العمل الإضافي"><span style="color:#3b82f6">${data.overtime || 0} أيام</span></td>
                <td data-label="لم يتم الانصراف"><span style="color:${data.noCheckout > 0 ? '#f59e0b' : 'inherit'}">${data.noCheckout || 0} أيام</span></td>
                <td data-label="مبلغ العمل الإضافي"><span style="color:#3b82f6">${data.overtimePay.toFixed(2)} ج.م</span></td>
                <td data-label="بدل الانتقال">${data.totalTransport.toFixed(2)} ج.م</td>
            </tr>
        `;
    }

    document.getElementById('kpiTotalLates').innerText = kpiTotalLates;
    document.getElementById('kpiActiveEmp').innerText = kpiActiveEmp;

    updateCharts(names, lates);
}

async function sendCustomReport() {
    const startStr = document.getElementById('reportStartDate').value;
    const endStr = document.getElementById('reportEndDate').value;
    
    if(!startStr || !endStr) return alert("يرجى اختيار الفترة الزمنية أولاً");

    if(!confirm("هل تريد إرسال هذا التقرير للإيميلات المسجلة في الإعدادات؟")) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'sendManualReport', 
                startDate: startStr, 
                endDate: endStr 
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        alert(result.success ? "✅ تم إرسال التقرير بنجاح" : "❌ فشل الإرسال: " + result.message);
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

// Export Report to Excel - Professional HR Report with Advanced Styling
function exportReportToExcel() {
    const startStr = document.getElementById('reportStartDate').value;
    const endStr = document.getElementById('reportEndDate').value;
    const tbody = document.getElementById('reportsTableBody');

    if (!tbody || tbody.children.length === 0) {
        alert('لا يوجد بيانات للتصدير. قم بتوليد التقرير أولاً.');
        return;
    }

    // Extract data from the table
    const data = [];
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 9) {
            data.push({
                'ID الموظف': cells[0].textContent.trim(),
                'اسم الموظف': cells[1].textContent.trim(),
                'أيام الحضور': cells[2].textContent.trim(),
                'أيام الغياب': cells[3].textContent.trim(),
                'التأخير': cells[4].textContent.trim(),
                'العمل الإضافي': cells[5].textContent.trim(),
                'لم يتم الانصراف': cells[6].textContent.trim(),
                'مبلغ العمل الإضافي': cells[7].textContent.trim(),
                'بدل الانتقال': cells[8].textContent.trim()
            });
        }
    });

    if (data.length === 0) {
        alert('لا يوجد بيانات للتصدير');
        return;
    }

    // Calculate totals for summary row
    const totals = {
        daysPresent: 0,
        daysAbsent: 0,
        lates: 0,
        overtime: 0,
        noCheckout: 0,
        overtimePay: 0,
        transport: 0
    };

    data.forEach(row => {
        totals.daysPresent += parseInt(row['أيام الحضور']) || 0;
        totals.daysAbsent += parseInt(row['أيام الغياب']) || 0;
        totals.lates += parseInt(row['التأخير']) || 0;
        totals.overtime += parseInt(row['العمل الإضافي']) || 0;
        totals.noCheckout += parseInt(row['لم يتم الانصراف']) || 0;
        totals.overtimePay += parseFloat(row['مبلغ العمل الإضافي'].replace(/[^0-9.]/g, '')) || 0;
        totals.transport += parseFloat(row['بدل الانتقال'].replace(/[^0-9.]/g, '')) || 0;
    });

    // Build sheet data
    const headers = ['ID الموظف', 'اسم الموظف', 'أيام الحضور', 'أيام الغياب', 'التأخير', 'العمل الإضافي', 'لم يتم الانصراف', 'مبلغ العمل الإضافي', 'بدل الانتقال'];

    const finalData = [
        ['تقرير الحضور والبدلات - نظام HR'],
        [`الفترة: ${startStr} إلى ${endStr} | إجمالي الموظفين: ${data.length}`],
        [''],
        headers,
        ...data.map(row => [
            row['ID الموظف'],
            row['اسم الموظف'],
            parseInt(row['أيام الحضور']) || 0,
            parseInt(row['أيام الغياب']) || 0,
            parseInt(row['التأخير']) || 0,
            parseInt(row['العمل الإضافي']) || 0,
            parseInt(row['لم يتم الانصراف']) || 0,
            parseFloat(row['مبلغ العمل الإضافي'].replace(/[^0-9.]/g, '')) || 0,
            parseFloat(row['بدل الانتقال'].replace(/[^0-9.]/g, '')) || 0
        ]),
        [''], // Empty row before totals
        ['الإجمالي', '', totals.daysPresent, totals.daysAbsent, totals.lates, totals.overtime, totals.noCheckout, totals.overtimePay, totals.transport]
    ];

    const ws = XLSX.utils.aoa_to_sheet(finalData);

    // Column widths optimized for content
    ws['!cols'] = [
        { wch: 14 }, // ID
        { wch: 28 }, // Name (wider for Arabic names)
        { wch: 14 }, // Present
        { wch: 14 }, // Absent
        { wch: 12 }, // Late
        { wch: 15 }, // Overtime
        { wch: 16 }, // No Checkout
        { wch: 20 }, // Overtime Pay
        { wch: 16 }  // Transport
    ];

    // Freeze panes: freeze header row (row 4)
    ws['!freeze'] = { xSplit: 0, ySplit: 4 };

    // Style definitions
    const borderStyle = {
        top: { style: "thin", color: { rgb: "B4B4B4" } },
        bottom: { style: "thin", color: { rgb: "B4B4B4" } },
        left: { style: "thin", color: { rgb: "B4B4B4" } },
        right: { style: "thin", color: { rgb: "B4B4B4" } }
    };

    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, size: 11, name: "Arial" },
        fill: { fgColor: { rgb: "1F4E79" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: borderStyle
    };

    const dataCellStyle = {
        alignment: { horizontal: "right", vertical: "center" },
        border: borderStyle,
        font: { name: "Arial", size: 10 }
    };

    const numberStyle = {
        alignment: { horizontal: "center", vertical: "center" },
        border: borderStyle,
        font: { name: "Arial", size: 10 }
    };

    const currencyStyle = {
        alignment: { horizontal: "right", vertical: "center" },
        border: borderStyle,
        font: { name: "Arial", size: 10 },
        numFmt: '"ج.م "#,##0.00'
    };

    const zebraStyle = {
        fill: { fgColor: { rgb: "F2F2F2" }, patternType: "solid" }
    };

    const totalRowStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, size: 11, name: "Arial" },
        fill: { fgColor: { rgb: "217346" }, patternType: "solid" },
        alignment: { horizontal: "right", vertical: "center" },
        border: borderStyle
    };

    const totalNumberStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, size: 11, name: "Arial" },
        fill: { fgColor: { rgb: "217346" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
        border: borderStyle
    };

    const totalCurrencyStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, size: 11, name: "Arial" },
        fill: { fgColor: { rgb: "217346" }, patternType: "solid" },
        alignment: { horizontal: "right", vertical: "center" },
        border: borderStyle,
        numFmt: '"ج.م "#,##0.00'
    };

    const titleStyle = {
        font: { bold: true, size: 18, color: { rgb: "1F4E79" }, name: "Arial" },
        alignment: { horizontal: "center", vertical: "center" }
    };

    const subtitleStyle = {
        font: { italic: true, size: 11, color: { rgb: "666666" }, name: "Arial" },
        alignment: { horizontal: "center", vertical: "center" }
    };

    // Apply styles to all cells
    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[cellAddress]) continue;

            // Title row (row 1)
            if (R === 0) {
                ws[cellAddress].s = titleStyle;
            }
            // Subtitle row (row 2)
            else if (R === 1) {
                ws[cellAddress].s = subtitleStyle;
            }
            // Header row (row 4 - index 3)
            else if (R === 3) {
                ws[cellAddress].s = headerStyle;
            }
            // Total row (last row)
            else if (R === range.e.r) {
                if (C === 0) {
                    ws[cellAddress].s = totalRowStyle;
                } else if (C === 1) {
                    ws[cellAddress].s = totalRowStyle;
                } else if (C >= 7) {
                    ws[cellAddress].s = totalCurrencyStyle;
                    ws[cellAddress].z = '"ج.م "#,##0.00';
                } else {
                    ws[cellAddress].s = totalNumberStyle;
                }
            }
            // Data rows
            else if (R > 3 && R < range.e.r - 1) {
                const isEven = (R - 4) % 2 === 0;
                const baseStyle = isEven ? { ...dataCellStyle, ...zebraStyle } : dataCellStyle;

                if (C === 0) { // ID - center aligned
                    ws[cellAddress].s = { ...baseStyle, alignment: { horizontal: "center", vertical: "center" } };
                } else if (C === 1) { // Name - right aligned
                    ws[cellAddress].s = baseStyle;
                } else if (C >= 7) { // Currency columns
                    ws[cellAddress].s = { ...baseStyle, ...currencyStyle };
                    ws[cellAddress].z = '"ج.م "#,##0.00';
                } else { // Number columns
                    ws[cellAddress].s = { ...baseStyle, ...numberStyle };
                }
            }
        }
    }

    // Merge title cells
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }
    ];

    // Set row heights
    ws['!rows'] = [
        { hpt: 30 }, // Title
        { hpt: 20 }, // Subtitle
        { hpt: 10 }, // Empty
        { hpt: 35 }, // Header
        ...data.map(() => ({ hpt: 22 })),
        { hpt: 10 }, // Empty before totals
        { hpt: 28 }  // Totals
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير الحضور');

    // Generate filename with date
    const today = new Date().toISOString().split('T')[0];
    const filename = `HR_Attendance_Report_${today}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
}

// Export Daily Attendance Records to Excel
function exportAttendanceToExcel() {
    const tbody = document.getElementById('attendanceTableBody');
    const filterDate = document.getElementById('attendanceDateFilter').value;
    const presentCount = document.getElementById('statPresent').textContent;
    const absentCount = document.getElementById('statAbsent').textContent;

    if (!tbody || tbody.children.length === 0) {
        alert('لا يوجد بيانات للتصدير');
        return;
    }

    // Extract data from table
    const data = [];
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
            data.push({
                'الموظف': cells[0].textContent.trim(),
                'الموقع': cells[1].textContent.trim(),
                'وقت الحضور': cells[2].textContent.trim(),
                'وقت الانصراف': cells[3].textContent.trim(),
                'بدل الانتقال': cells[4].textContent.trim(),
                'الحالة': cells[5].textContent.trim()
            });
        }
    });

    if (data.length === 0) {
        alert('لا يوجد بيانات للتصدير');
        return;
    }

    const headers = ['الموظف', 'الموقع', 'وقت الحضور', 'وقت الانصراف', 'بدل الانتقال', 'الحالة'];

    const finalData = [
        ['سجلات العمليات الشاملة - نظام HR'],
        [`التاريخ: ${filterDate || 'جميع التواريخ'} | الحاضرين: ${presentCount} | الغائبين: ${absentCount}`],
        [''],
        headers,
        ...data.map(row => [
            row['الموظف'],
            row['الموقع'],
            row['وقت الحضور'],
            row['وقت الانصراف'],
            row['بدل الانتقال'],
            row['الحالة']
        ])
    ];

    const ws = XLSX.utils.aoa_to_sheet(finalData);

    ws['!cols'] = [
        { wch: 25 }, // Employee
        { wch: 20 }, // Site
        { wch: 18 }, // Check In
        { wch: 18 }, // Check Out
        { wch: 15 }, // Transport
        { wch: 12 }  // Status
    ];

    ws['!freeze'] = { xSplit: 0, ySplit: 4 };

    const borderStyle = {
        top: { style: "thin", color: { rgb: "B4B4B4" } },
        bottom: { style: "thin", color: { rgb: "B4B4B4" } },
        left: { style: "thin", color: { rgb: "B4B4B4" } },
        right: { style: "thin", color: { rgb: "B4B4B4" } }
    };

    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, size: 11, name: "Arial" },
        fill: { fgColor: { rgb: "1F4E79" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
        border: borderStyle
    };

    const cellStyle = {
        alignment: { horizontal: "right", vertical: "center" },
        border: borderStyle,
        font: { name: "Arial", size: 10 }
    };

    const zebraStyle = {
        fill: { fgColor: { rgb: "F2F2F2" }, patternType: "solid" }
    };

    const titleStyle = {
        font: { bold: true, size: 16, color: { rgb: "1F4E79" }, name: "Arial" },
        alignment: { horizontal: "center", vertical: "center" }
    };

    const subtitleStyle = {
        font: { italic: true, size: 10, color: { rgb: "666666" }, name: "Arial" },
        alignment: { horizontal: "center", vertical: "center" }
    };

    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[cellAddress]) continue;

            if (R === 0) ws[cellAddress].s = titleStyle;
            else if (R === 1) ws[cellAddress].s = subtitleStyle;
            else if (R === 3) ws[cellAddress].s = headerStyle;
            else if (R > 3) {
                const isEven = (R - 4) % 2 === 0;
                ws[cellAddress].s = isEven ? { ...cellStyle, ...zebraStyle } : cellStyle;
            }
        }
    }

    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجلات الحضور');

    const today = new Date().toISOString().split('T')[0];
    const filename = `Daily_Attendance_${filterDate || today}.xlsx`;

    XLSX.writeFile(wb, filename);
}

// Export Employee Detailed Report to Excel
function exportEmployeeDetailedToExcel() {
    const employeeSelect = document.getElementById('employeeDetailEmployee');
    const employeeName = employeeSelect.options[employeeSelect.selectedIndex]?.text || 'غير محدد';
    const startStr = document.getElementById('employeeReportStartDate').value;
    const endStr = document.getElementById('employeeReportEndDate').value;

    const tbody = document.getElementById('employeeDetailTableBody');
    if (!tbody || tbody.children.length === 0 || tbody.querySelector('.employee-report-empty')) {
        alert('لا يوجد بيانات للتصدير. قم بعرض التقرير أولاً.');
        return;
    }

    // Get KPI values
    const present = document.getElementById('employeeDetailPresent').textContent;
    const absent = document.getElementById('employeeDetailAbsent').textContent;
    const late = document.getElementById('employeeDetailLate').textContent;
    const overtime = document.getElementById('employeeDetailOvertime').textContent;
    const overtimePay = document.getElementById('employeeDetailOvertimePay').textContent;
    const transport = document.getElementById('employeeDetailTransport').textContent;

    // Extract data from table
    const data = [];
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
            data.push({
                'التاريخ': cells[0].textContent.trim(),
                'الموقع': cells[1].textContent.trim(),
                'وقت الحضور': cells[2].textContent.trim(),
                'وقت الانصراف': cells[3].textContent.trim(),
                'الحالة': cells[4].textContent.trim(),
                'البدل': cells[5].textContent.trim()
            });
        }
    });

    const headers = ['التاريخ', 'الموقع', 'وقت الحضور', 'وقت الانصراف', 'الحالة', 'البدل'];

    const finalData = [
        ['التقرير التفصيلي للموظف - نظام HR'],
        [`الموظف: ${employeeName} | الفترة: ${startStr} إلى ${endStr}`],
        ['ملخص:', `حضور: ${present}`, `غياب: ${absent}`, `تأخير: ${late}`, `إضافي: ${overtime}`, `بدل إضافي: ${overtimePay} ج.م`, `بدل انتقال: ${transport} ج.م`],
        [''],
        headers,
        ...data.map(row => [
            row['التاريخ'],
            row['الموقع'],
            row['وقت الحضور'],
            row['وقت الانصراف'],
            row['الحالة'],
            row['البدل']
        ])
    ];

    const ws = XLSX.utils.aoa_to_sheet(finalData);

    ws['!cols'] = [
        { wch: 15 }, // Date
        { wch: 22 }, // Site
        { wch: 18 }, // Check In
        { wch: 18 }, // Check Out
        { wch: 12 }, // Status
        { wch: 15 }  // Allowance
    ];

    ws['!freeze'] = { xSplit: 0, ySplit: 5 };

    const borderStyle = {
        top: { style: "thin", color: { rgb: "B4B4B4" } },
        bottom: { style: "thin", color: { rgb: "B4B4B4" } },
        left: { style: "thin", color: { rgb: "B4B4B4" } },
        right: { style: "thin", color: { rgb: "B4B4B4" } }
    };

    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" }, size: 11, name: "Arial" },
        fill: { fgColor: { rgb: "1F4E79" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
        border: borderStyle
    };

    const summaryStyle = {
        font: { bold: true, size: 10, color: { rgb: "217346" }, name: "Arial" },
        fill: { fgColor: { rgb: "E8F5E9" }, patternType: "solid" },
        alignment: { horizontal: "center", vertical: "center" },
        border: borderStyle
    };

    const cellStyle = {
        alignment: { horizontal: "right", vertical: "center" },
        border: borderStyle,
        font: { name: "Arial", size: 10 }
    };

    const zebraStyle = {
        fill: { fgColor: { rgb: "F2F2F2" }, patternType: "solid" }
    };

    const titleStyle = {
        font: { bold: true, size: 16, color: { rgb: "1F4E79" }, name: "Arial" },
        alignment: { horizontal: "center", vertical: "center" }
    };

    const subtitleStyle = {
        font: { italic: true, size: 11, color: { rgb: "666666" }, name: "Arial" },
        alignment: { horizontal: "center", vertical: "center" }
    };

    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[cellAddress]) continue;

            if (R === 0) ws[cellAddress].s = titleStyle;
            else if (R === 1) ws[cellAddress].s = subtitleStyle;
            else if (R === 2) ws[cellAddress].s = summaryStyle;
            else if (R === 4) ws[cellAddress].s = headerStyle;
            else if (R > 4) {
                const isEven = (R - 5) % 2 === 0;
                ws[cellAddress].s = isEven ? { ...cellStyle, ...zebraStyle } : cellStyle;
            }
        }
    }

    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير الموظف');

    const today = new Date().toISOString().split('T')[0];
    const safeName = employeeName.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
    const filename = `Employee_Report_${safeName}_${today}.xlsx`;

    XLSX.writeFile(wb, filename);
}

function updateCharts(labels, latesData) {
    const ctxLates = document.getElementById('latesChart').getContext('2d');

    if(latesChartInstance) latesChartInstance.destroy();
    
    latesChartInstance = new Chart(ctxLates, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: 'مرات التأخير',
                data: latesData,
                backgroundColor: [
                    '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#d946ef'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: { title: { display: true, text: 'نسبة التأخير بين الموظفين' } }
        }
    });
}

async function fetchEmployees(force = false) {
    if (!force && allEmployees.length) {
        renderEmployeesTable(allEmployees);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getEmployees`);
        const result = await res.json();
        if(result.success) {
            allEmployees = result.data;
            populateEmployeeDetailEmployees();
            renderEmployeesTable(allEmployees);
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderEmployeesTable(data) {
    const tbody = document.getElementById('employeesTableBody');
    tbody.innerHTML = '';
    data.forEach(record => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="الاسم">${record.name}</td>
            <td data-label="البريد">${record.email}</td>
            <td data-label="الهاتف">${record.phone || '-'}</td>
            <td data-label="المرتب">${record.salary ? parseFloat(record.salary).toFixed(0) + ' ج.م' : '-'}</td>
            <td data-label="الصلاحية">${record.role}</td>
            <td data-label="البصمة">${record.faceDescriptor ? '✅ مسجل' : '❌ لا يوجد'}</td>
            <td data-label="الإجراءات" style="display:flex; gap:8px; justify-content:center; padding:10px;">
                <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="editEmployee('${record.id}')">تعديل ✏️</button>
                <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" onclick="deleteEntity('deleteEmployee', '${record.id}', '${record.name}')">حذف 🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function fetchSites(force = false) {
    if (!force && allSites.length) {
        renderSitesTable(allSites);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getSites`);
        const result = await res.json();
        if(result.success) {
            allSites = result.data;
            renderSitesTable(allSites);
        }
    } catch(e) { console.error("Fetch Sites Error:", e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderSitesTable(data) {
    const tbody = document.getElementById('sitesTableBody');
    tbody.innerHTML = '';
    data.forEach(record => {
        const isTemporary = Boolean(record.isTemporary);
        const siteName = isTemporary
            ? `${record.name} <small style="color:#f59e0b;">(مؤقت - اليوم فقط)</small>`
            : record.name;
        const actions = isTemporary
            ? '<span style="color:var(--text-muted);">-</span>'
            : `
                <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="editSite('${record.id}')">تعديل ✏️</button>
                <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" onclick="deleteEntity('deleteSite', '${record.id}', '${record.name}')">حذف 🗑️</button>
            `;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="اسم الموقع">${siteName}</td>
            <td data-label="خط العرض">${record.latitude}</td>
            <td data-label="خط الطول">${record.longitude}</td>
            <td data-label="النطاق">${record.radius} متر</td>
            <td data-label="رابط الموقع">${record.mapLink ? `<a href="${record.mapLink}" target="_blank" style="color:var(--primary); text-decoration:underline;">فتح الرابط 📍</a>` : '-'}</td>
            <td data-label="الإجراءات" style="display:flex; gap:8px; justify-content:center; padding:10px;">
                ${actions}
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function editEmployee(id) {
    const emp = allEmployees.find(e => String(e.id) === String(id));
    if(!emp) return;
    document.getElementById('editEmpId').value = emp.id;
    document.getElementById('empModalTitle').innerText = 'تعديل بيانات موظف';
    document.getElementById('empName').value = emp.name;
    document.getElementById('empEmail').value = emp.email;
    document.getElementById('empPhone').value = emp.phone || '';
    document.getElementById('empPass').value = ''; // Don't show password for security
    document.getElementById('empPass').placeholder = 'اتركها فارغة للاحتفاظ بكلمة المرور الحالية';
    document.getElementById('empRole').value = emp.role;
    document.getElementById('empSalary').value = emp.salary || 0;
    document.getElementById('empTransportPrice').value = emp.transportPrice || 0;
    
    // Assigned sites - normalize to array for openEmployeeModal
    const assigned = Array.isArray(emp.assignedSites) ? emp.assignedSites : (emp.assignedSites ? String(emp.assignedSites).split(',').map(s => s.trim()).filter(Boolean) : []);
    document.getElementById('empSites').value = assigned.join(',');
    
    // Create a normalized emp object with array assignedSites for openEmployeeModal
    const normalizedEmp = {
        ...emp,
        assignedSites: assigned
    };
    
    await openEmployeeModal('edit', normalizedEmp);
}

function editSite(id) {
    const site = allSites.find(s => String(s.id) === String(id));
    if(!site) return;
    if (site.isTemporary) {
        alert('هذا موقع مؤقت (موافقة اليوم فقط) ولا يمكن تعديله من إدارة المواقع.');
        return;
    }
    document.getElementById('editSiteId').value = site.id;
    document.getElementById('siteModalTitle').innerText = 'تعديل بيانات الموقع';
    document.getElementById('siteName').value = site.name;
    document.getElementById('siteMapLink').value = site.mapLink || '';
    document.getElementById('siteLat').value = site.latitude;
    document.getElementById('siteLng').value = site.longitude;
    document.getElementById('siteRadius').value = site.radius;
    openSiteModal();
}

function toggleAdvancedEmpOptions() {
    const el = document.getElementById('advancedEmpOptions');
    el.classList.toggle('hidden');
}

async function deleteEntity(action, id, name) {
    if(!confirm(`هل أنت متأكد من حذف "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action, id }), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            if(action === 'deleteEmployee') fetchEmployees();
            else fetchSites();
        } else alert("خطأ في الحذف: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function openEmployeeModal(mode = 'add', emp = null) {
    if (mode !== 'edit') {
        document.getElementById('editEmpId').value = '';
        document.getElementById('empModalTitle').innerText = 'إضافة موظف جديد';
        document.getElementById('empName').value = '';
        document.getElementById('empEmail').value = '';
        document.getElementById('empPhone').value = '';
        document.getElementById('empPass').value = '';
        document.getElementById('empPass').placeholder = 'اختياري: سيتم توليد كلمة مرور مؤقتة تلقائيًا';
        document.getElementById('empRole').value = 'employee';
        document.getElementById('empSalary').value = 0;
        document.getElementById('empTransportPrice').value = 0;
        document.getElementById('empSites').value = '';
        document.getElementById('advancedEmpOptions').classList.add('hidden');
    }

    // Render Sites List
    const container = document.getElementById('empSitesContainer');
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">جاري تحميل المواقع...</div>';
    
    if (!allSites.length) {
        await fetchSites();
    }

    container.innerHTML = '';
    allSites.filter(s => !s.isTemporary).forEach(site => {
        const isAssigned = emp && emp.assignedSites && emp.assignedSites.includes(String(site.id));
        const allowance = emp && emp.siteAllowances ? emp.siteAllowances.find(a => String(a.siteId) === String(site.id)) : null;
        const price = allowance ? allowance.transportPrice : (site.transportPrice || 0);

        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '10px';
        div.style.marginBottom = '8px';
        div.style.padding = '5px';
        div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

        div.innerHTML = `
            <input type="checkbox" class="site-checkbox" value="${site.id}" ${isAssigned ? 'checked' : ''} style="width:18px; height:18px;">
            <span style="flex:1; font-size:0.9rem;">${site.name}</span>
            <div style="display:flex; align-items:center; gap:5px;">
                <input type="number" class="site-price-input" data-site-id="${site.id}" value="${price}" 
                    style="width:70px; padding:4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--card-border); color:white; font-size:0.85rem;"
                    ${!isAssigned ? 'disabled' : ''}>
                <span style="font-size:0.75rem; color:var(--text-muted);">ج.م</span>
            </div>
        `;

        // Toggle price input based on checkbox
        const checkbox = div.querySelector('.site-checkbox');
        const priceInput = div.querySelector('.site-price-input');
        checkbox.addEventListener('change', () => {
            priceInput.disabled = !checkbox.checked;
        });

        container.appendChild(div);
    });

    if (!allSites.length) {
        container.innerHTML = '<div style="color: var(--danger); font-size: 0.85rem; text-align: center;">لم يتم العثور على مواقع.</div>';
    }

    document.getElementById('employeeModal').classList.remove('hidden');
}
function closeEmployeeModal() { document.getElementById('employeeModal').classList.add('hidden'); }

async function saveEmployee() {
    const editId = document.getElementById('editEmpId').value;
    const name = document.getElementById('empName').value.trim();
    const email = document.getElementById('empEmail').value.trim();
    const phone = document.getElementById('empPhone').value.trim();
    const pass = document.getElementById('empPass').value.trim();
    const role = document.getElementById('empRole').value;
    
    // Collect sites and allowances
    const selectedSites = [];
    const siteAllowances = [];
    
    document.querySelectorAll('#empSitesContainer > div').forEach(div => {
        const checkbox = div.querySelector('.site-checkbox');
        const priceInput = div.querySelector('.site-price-input');
        if (checkbox.checked) {
            const siteId = checkbox.value;
            const price = parseFloat(priceInput.value) || 0;
            selectedSites.push(siteId);
            siteAllowances.push({ siteId, transportPrice: price });
        }
    });

    if(!phone) return alert("أدخل رقم الهاتف");
    if(!name || !email) return alert("أكمل البيانات");
    
    const autoGeneratedPassword = (!editId && !pass)
        ? ('TMP' + Math.floor(100000 + Math.random() * 900000))
        : '';
    
    const payload = {
        action: editId ? 'updateEmployee' : 'saveEmployee',
        id: editId || ('EMP' + Math.floor(1000 + Math.random() * 9000)),
        name: name, 
        email: email, 
        password: pass || autoGeneratedPassword, 
        phone: phone, 
        role: role,
        assignedSites: selectedSites.join(','),
        siteAllowances: siteAllowances,
        salary: document.getElementById('empSalary').value || 0,
        transportPrice: document.getElementById('empTransportPrice').value || 0
    };
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            if (autoGeneratedPassword) {
                alert(`تم إنشاء كلمة مرور مؤقتة تلقائيًا: ${autoGeneratedPassword}`);
            }
            closeEmployeeModal();
            fetchEmployees(true); // Force refresh to get updated siteAllowances
            // Refresh report if reports tab is active
            if (localStorage.getItem('hrActiveTab') === 'reports') {
                generateReport();
            }
        } else alert("خطأ في الحفظ: " + result.message);
    } catch(e) {
        console.error(e);
        alert("خطأ في الاتصال: " + e.message);
    }
    document.getElementById('loader').classList.add('hidden');
}

function openSiteModal() { document.getElementById('siteModal').classList.remove('hidden'); }
function closeSiteModal() { document.getElementById('siteModal').classList.add('hidden'); }

function parseMapLink() {
    if (parseMapLinkTimer) clearTimeout(parseMapLinkTimer);
    parseMapLinkTimer = setTimeout(runParseMapLink, 300);
}

async function runParseMapLink() {
    const link = document.getElementById('siteMapLink').value.trim();
    const latInput = document.getElementById('siteLat');
    const lngInput = document.getElementById('siteLng');

    if (!link) {
        latInput.placeholder = 'تلقائي عبر الرابط';
        lngInput.placeholder = 'تلقائي عبر الرابط';
        return;
    }

    const currentRequestId = ++parseMapLinkRequestId;
    latInput.value = '';
    lngInput.value = '';
    latInput.placeholder = 'جاري استخراج البيانات...';
    lngInput.placeholder = 'جاري استخراج البيانات...';

    let extracted = extractLatLngFromUrl(link);
    const shouldAskBackend = link.includes('maps.app.goo.gl') || link.includes('goo.gl') || link.includes('google.com/maps');

    if (!extracted && shouldAskBackend) {
        try {
            const res = await fetch(API_URL, {
                method: 'POST', body: JSON.stringify({ action: 'resolveMapLink', link: link }), headers:{'Content-Type':'text/plain'}
            });
            const result = await res.json();
            if (currentRequestId !== parseMapLinkRequestId) return;

            if (result.success) {
                if (result.lat && result.lng) {
                    extracted = { lat: String(result.lat), lng: String(result.lng) };
                } else if (result.url) {
                    extracted = extractLatLngFromUrl(result.url);
                }
            } else {
                throw new Error('Backend Error: ' + result.message);
            }
        } catch (e) {
            console.error('Failed to resolve link', e);
        }
    }

    if (currentRequestId !== parseMapLinkRequestId) return;

    if (extracted) {
        latInput.value = extracted.lat;
        lngInput.value = extracted.lng;
        latInput.placeholder = 'تلقائي عبر الرابط';
        lngInput.placeholder = 'تلقائي عبر الرابط';
        return;
    }

    latInput.placeholder = 'فشل الاستخراج (انسخ الأرقام يدوياً)';
    lngInput.placeholder = 'فشل الاستخراج (انسخ الأرقام يدوياً)';
}

function extractLatLngFromUrl(url) {
    if (!url) return null;

    const candidates = [String(url)];
    try {
        const decoded = decodeURIComponent(String(url));
        if (decoded !== url) candidates.push(decoded);
        const decodedTwice = decodeURIComponent(decoded);
        if (decodedTwice !== decoded && decodedTwice !== url) candidates.push(decodedTwice);
    } catch (e) {}

    const patterns = [
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
        /[?&]q=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
        /[?&]query=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
        /center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i,
        /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
        /place\/[^\/]+\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i
    ];

    for (const candidate of candidates) {
        for (const pattern of patterns) {
            const match = candidate.match(pattern);
            if (!match) continue;
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[2]);
            if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                return { lat: String(lat), lng: String(lng) };
            }
        }
    }

    return null;
}
async function saveSite() {
    const editId = document.getElementById('editSiteId').value;
    const name = document.getElementById('siteName').value.trim();
    const lat = document.getElementById('siteLat').value.trim();
    const lng = document.getElementById('siteLng').value.trim();
    const radius = document.getElementById('siteRadius').value.trim();
    
    if(!name || !lat || !lng || !radius) return alert("الرجاء إكمال كافة البيانات");
    
    const payload = {
        action: editId ? 'updateSite' : 'saveSite',
        id: editId || Math.floor(10000 + Math.random() * 90000), 
        name: name, latitude: lat, longitude: lng, radius: radius,
        mapLink: document.getElementById('siteMapLink').value.trim()
    };
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'} });
        const result = await res.json();
        if(result.success) {
            closeSiteModal();
            fetchSites();
            // Clear inputs
            document.getElementById('siteName').value = '';
            document.getElementById('siteMapLink').value = '';
            document.getElementById('siteLat').value = '';
            document.getElementById('siteLng').value = '';
            document.getElementById('siteRadius').value = '20';
        } else { alert("خطأ في الحفظ: " + (result.message||'')); }
    } catch(e) { console.error(e); alert("خطأ في الاتصال: " + e.message); }
    document.getElementById('loader').classList.add('hidden');
}

// Sidebar Toggle Logic
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('show');
}

async function fetchSettings(force = false) {
    if (!force && Object.keys(appSettings).length) {
        renderSettings(appSettings);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getSettings`);
        const result = await res.json();
        if (result.success) {
            appSettings = result.data;
            renderSettings(appSettings);
        }
    } catch (e) { console.error("Fetch Settings error", e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderSettings(data) {
    // Ensure time values are in HH:mm format for input[type="time"]
    let start = data.workStartTime || "09:00";
    let end = data.workEndTime || "17:00";
    
    // Basic normalization just in case
    if (start.match(/^\d:\d\d$/)) start = "0" + start;
    if (end.match(/^\d:\d\d$/)) end = "0" + end;

    document.getElementById('setWorkStartTime').value = start;
    document.getElementById('setWorkEndTime').value = end;
    
    // Reports settings
    document.getElementById('setReportEmails').value = data.reportEmails || "";
    document.getElementById('setDailyReport').checked = data.dailyReportEnabled === "true";
    document.getElementById('setMonthlyReport').checked = data.monthlyReportEnabled === "true";

    // Weekend days (default: Friday=5, Saturday=6)
    const weekendDays = data.weekendDays || "5,6";
    const weekendArray = weekendDays.split(',').map(d => parseInt(d.trim()));
    document.getElementById('weekendFri').checked = weekendArray.includes(5);
    document.getElementById('weekendSat').checked = weekendArray.includes(6);
    document.getElementById('weekendSun').checked = weekendArray.includes(0);
    document.getElementById('weekendMon').checked = weekendArray.includes(1);
    document.getElementById('weekendTue').checked = weekendArray.includes(2);
    document.getElementById('weekendWed').checked = weekendArray.includes(3);
    document.getElementById('weekendThu').checked = weekendArray.includes(4);
}

function getWeekendDaysFromUI() {
    const days = [];
    if (document.getElementById('weekendFri').checked) days.push(5);
    if (document.getElementById('weekendSat').checked) days.push(6);
    if (document.getElementById('weekendSun').checked) days.push(0);
    if (document.getElementById('weekendMon').checked) days.push(1);
    if (document.getElementById('weekendTue').checked) days.push(2);
    if (document.getElementById('weekendWed').checked) days.push(3);
    if (document.getElementById('weekendThu').checked) days.push(4);
    return days.join(',');
}

async function saveSettings() {
    const workStartTime = document.getElementById('setWorkStartTime').value;
    const workEndTime = document.getElementById('setWorkEndTime').value;
    const reportEmails = document.getElementById('setReportEmails').value;
    const dailyEnabled = document.getElementById('setDailyReport').checked;
    const monthlyEnabled = document.getElementById('setMonthlyReport').checked;
    const weekendDays = getWeekendDaysFromUI();

    document.getElementById('loader').classList.remove('hidden');
    try {
        const payload = {
            action: 'updateSettings',
            settings: {
                workStartTime: workStartTime,
                workEndTime: workEndTime,
                reportEmails: reportEmails,
                dailyReportEnabled: dailyEnabled ? "true" : "false",
                monthlyReportEnabled: monthlyEnabled ? "true" : "false",
                weekendDays: weekendDays
            }
        };

        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        
        if (result.success) {
            alert("✅ تم حفظ الإعدادات بنجاح");
        } else {
            alert("❌ خطأ: " + result.message);
        }
    } catch (e) {
        console.error("Save settings error", e);
        alert("حدث خطأ في الاتصال");
    }
    document.getElementById('loader').classList.add('hidden');
}

async function triggerSmartSync() {
    const syncBtn = document.getElementById('btnSyncDB');
    const loader = document.getElementById('loader');

    if (!syncBtn) return;

    const originalText = syncBtn.innerText;
    syncBtn.disabled = true;
    syncBtn.innerText = "Syncing...";
    if (loader) loader.classList.remove('hidden');

    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        let result = {};
        try {
            result = await res.json();
        } catch (_) {
            result = {};
        }

        if (!res.ok || !result.success) {
            throw new Error(result.message || "Smart sync failed");
        }

        const stats = result.stats || {};
        const issues = Array.isArray(result.issues) ? result.issues : [];
        const warningPreview = issues.slice(0, 3);
        alert(
            `Smart sync completed.\n` +
            `Employees added: ${stats.employeesAdded || 0} | skipped: ${stats.employeesSkipped || 0}\n` +
            `Sites added: ${stats.sitesAdded || 0} | skipped: ${stats.sitesSkipped || 0}\n` +
            `Attendance added: ${stats.attendanceAdded || 0} | updated: ${stats.attendanceUpdated || 0} | skipped: ${stats.attendanceSkipped || 0}\n` +
            `Warnings: ${issues.length}` +
            (warningPreview.length ? `\n${warningPreview.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}` : '')
        );

        await initDashboard(true);
    } catch (e) {
        console.error("Smart sync error:", e);
        alert("Smart sync failed: " + (e.message || "Unexpected error"));
    } finally {
        syncBtn.disabled = false;
        syncBtn.innerText = originalText;
        if (loader) loader.classList.add('hidden');
    }
}

async function setupTriggers() {
    if(!confirm("سيتم الآن تفعيل مواعيد إرسال التقارير التلقائية. هل أنت متأكد؟")) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'createTriggers' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        alert(result.success ? "✅ تم تفعيل المواعيد بنجاح" : "❌ فشل التفعيل");
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

// ------ OFFICIAL HOLIDAYS LOGIC ------ //
async function fetchOfficialHolidays(force = false) {
    if (!force && allOfficialHolidays.length) {
        renderOfficialHolidaysTable(allOfficialHolidays);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getOfficialHolidays`);
        const result = await res.json();
        if (result.success) {
            allOfficialHolidays = result.data || [];
            renderOfficialHolidaysTable(allOfficialHolidays);
        }
    } catch (e) {
        console.error("Fetch Official Holidays Error:", e);
    }
    document.getElementById('loader').classList.add('hidden');
}

function renderOfficialHolidaysTable(data) {
    const tbody = document.getElementById('officialHolidaysTableBody');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center; color:var(--text-muted);">لا توجد إجازات رسمية مسجلة</td>
            </tr>
        `;
        return;
    }

    // Sort by date (newest first)
    const sorted = [...data].sort((a, b) => new Date(b.holidayDate) - new Date(a.holidayDate));

    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    sorted.forEach(holiday => {
        const dateStr = formatCairoDate(holiday.holidayDate);
        const dayName = dayNames[new Date(holiday.holidayDate).getDay()] || '-';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="التاريخ" dir="ltr">${dateStr}</td>
            <td data-label="اليوم">${dayName}</td>
            <td data-label="اسم الإجازة">${holiday.holidayName}</td>
            <td data-label="الإجراءات">
                <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" 
                    onclick="deleteOfficialHoliday('${holiday.id}', '${holiday.holidayName}')">حذف 🗑️</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function addOfficialHoliday() {
    const dateInput = document.getElementById('holidayDate');
    const nameInput = document.getElementById('holidayName');

    const holidayDate = dateInput.value;
    const holidayName = nameInput.value.trim();

    if (!holidayDate || !holidayName) {
        alert('يرجى إدخال تاريخ واسم الإجازة');
        return;
    }

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'addOfficialHoliday',
                holidayDate: holidayDate,
                holidayName: holidayName
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();

        if (result.success) {
            alert('✅ ' + result.message);
            dateInput.value = '';
            nameInput.value = '';
            await fetchOfficialHolidays(true);
            // Refresh dashboard data to update allOfficialHolidays
            await initDashboard(true);
            // Regenerate reports if tabs are active
            if (localStorage.getItem('hrActiveTab') === 'reports') {
                generateReport();
            }
            if (localStorage.getItem('hrActiveTab') === 'employeeDetails') {
                await generateEmployeeDetailedReport();
            }
        } else {
            alert('❌ ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function deleteOfficialHoliday(id, name) {
    if (!confirm(`هل أنت متأكد من حذف إجازة "${name}"؟`)) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'deleteOfficialHoliday',
                id: id
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();

        if (result.success) {
            alert('✅ ' + result.message);
            await fetchOfficialHolidays(true);
            // Refresh dashboard data to update allOfficialHolidays
            await initDashboard(true);
            // Regenerate reports if tabs are active
            if (localStorage.getItem('hrActiveTab') === 'reports') {
                generateReport();
            }
            if (localStorage.getItem('hrActiveTab') === 'employeeDetails') {
                await generateEmployeeDetailedReport();
            }
        } else {
            alert('❌ ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('حدث خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

// ------ SITE REQUESTS LOGIC ------ //
async function fetchSiteRequests(force = false) {
    if (!force && allSiteRequests.length) {
        renderSiteRequestsTable(allSiteRequests);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getSiteRequests`);
        const result = await res.json();
        if(result.success) {
            allSiteRequests = result.data;
            renderSiteRequestsTable(allSiteRequests);
        }
    } catch(e) { console.error("Fetch Site Requests error:", e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderSiteRequestsTable(data) {
    const tbody = document.getElementById('siteRequestsTableBody');
    tbody.innerHTML = '';
    [...data].reverse().forEach(req => {
        let statusText = 'قيد الانتظار';
        let statusColor = 'var(--warning)';

        if (req.status === 'approved') {
            statusText = 'تمت الموافقة (دائم)';
            statusColor = 'var(--secondary)';
        } else if (req.status === 'approved_today') {
            statusText = req.isActiveToday ? 'موافقة اليوم فقط (نشط)' : 'موافقة اليوم فقط (انتهت)';
            statusColor = req.isActiveToday ? '#22c55e' : 'var(--text-muted)';
        } else if (req.status === 'rejected') {
            statusText = 'مرفوض';
            statusColor = 'var(--danger)';
        }

        const canOverrideAutoApprovedToday = req.status === 'approved_today' && req.isAutoApproved && req.isActiveToday;
        const canManageRequest = req.status === 'pending' || canOverrideAutoApprovedToday;
        const actions = canManageRequest ? `
            <div style="display:flex; gap:8px;">
                <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto; background:var(--secondary);" onclick="approveRequest('${req.id}', '${req.suggestedName}')">موافقة ✓</button>
                <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="rejectRequest('${req.id}')">رفض ✕</button>
            </div>
        ` : '-';

        const mapLinkHtml = req.mapLink
            ? `<a href="${req.mapLink}" target="_blank" style="color:var(--primary); text-decoration:underline;">فتح الرابط 📍</a>`
            : 'لا يوجد';
        const noteText = (req.note || '').trim() || '-';
        const receiptHtml = req.receiptUrl
            ? `<a href="${req.receiptUrl}" target="_blank" style="color:var(--secondary); text-decoration:underline;">${req.receiptName || 'عرض المرفق'}</a>`
            : '-';

        const createdStr = req.timestamp ? formatCairoDate(req.timestamp) + ' ' + formatCairoTime(req.timestamp) : (req.timestamp || '-');
        const approvedStr = req.approvedAt ? formatCairoDate(req.approvedAt) + ' ' + formatCairoTime(req.approvedAt) : '';
        const dateStr = approvedStr ? `${createdStr}<br><small style="color:var(--text-muted);">اعتماد: ${approvedStr}</small>` : createdStr;

        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${req.employeeName}</td>
                <td data-label="اسم الموقع المقترح">${req.suggestedName}</td>
                <td data-label="رابط الخريطة">${mapLinkHtml}</td>
                <td data-label="ملاحظة الانتقالات">${noteText}</td>
                <td data-label="مرفق">${receiptHtml}</td>
                <td data-label="الإحداثيات" dir="ltr">${req.latitude}, ${req.longitude}</td>
                <td data-label="التاريخ">${dateStr}</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
                <td data-label="الإجراءات">${actions}</td>
            </tr>
        `;
    });
}
async function approveRequest(id, suggestedName) {
    const matchedRequest = allSiteRequests.find(req => String(req.id) === String(id));
    const currentTransportPrice = matchedRequest ? parseFloat(matchedRequest.transportPrice) : NaN;
    const currentRadius = matchedRequest ? parseFloat(matchedRequest.tempRadius) : NaN;

    document.getElementById('approveReqId').value = id;
    document.getElementById('approveSiteName').value = suggestedName;
    document.getElementById('approveTransportPrice').value = Number.isFinite(currentTransportPrice) ? currentTransportPrice : 120;
    document.getElementById('approveRadius').value = Number.isFinite(currentRadius) ? currentRadius : 100;
    document.getElementById('approveRequestModal').classList.remove('hidden');
}

function closeApproveModal() {
    document.getElementById('approveRequestModal').classList.add('hidden');
}

async function confirmApproval(mode) {
    const id = document.getElementById('approveReqId').value;
    const name = document.getElementById('approveSiteName').value;
    const transportPrice = document.getElementById('approveTransportPrice').value;
    const radius = document.getElementById('approveRadius').value;

    const matchedRequest = allSiteRequests.find(req => String(req.id) === String(id));
    const mapLink = matchedRequest ? matchedRequest.mapLink : '';

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'approveSiteRequest', 
                id: id, 
                name: name, 
                transportPrice: transportPrice, 
                radius: radius,
                mode: mode,
                mapLink: mapLink
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            closeApproveModal();
            await Promise.all([fetchSiteRequests(true), fetchSites(true)]);
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function rejectRequest(id) {
    if(!confirm("هل أنت متأكد من رفض هذا الموقع؟")) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'rejectSiteRequest', id: id }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            await fetchSiteRequests(true);
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function clearProcessedRequests() {
    if(!confirm("هل أنت متأكد من مسح جميع الطلبات التي تمت الموافقة عليها أو رفضها أو انتهت صلاحتها؟ هذا الإجراء لا يمكن التراجع عنه.")) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'clearProcessedRequests' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            await initDashboard(true); // Refresh all data to sync
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

// ------ ALLOWANCE UPGRADE SYSTEM ------ //
async function fetchAllowanceRequests(force = false) {
    if (!force && typeof allAllowanceRequests !== 'undefined' && allAllowanceRequests.length > 0) {
        renderAllowanceRequestsTable(allAllowanceRequests);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getAllowanceRequests`);
        const result = await res.json();
        if (result.success) {
            allAllowanceRequests = result.data || [];
            renderAllowanceRequestsTable(allAllowanceRequests);
        }
    } catch (e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderAllowanceRequestsTable(data) {
    const tbody = document.getElementById('allowanceRequestsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    [...data].forEach(req => {
        let statusText = 'قيد الانتظار';
        let statusColor = 'var(--warning)';
        let actions = `
            <button class="btn-primary" style="padding:5px 10px; font-size:0.8rem; width:auto; background:#22c55e;" onclick="handleAllowanceUpgrade('${req.id}', 'approved')">موافقة</button>
            <button class="btn-danger" style="padding:5px 10px; font-size:0.8rem; width:auto; background:transparent; border:1px solid var(--danger); color:var(--danger);" onclick="handleAllowanceUpgrade('${req.id}', 'rejected')">رفض</button>
        `;

        if (req.status === 'approved') {
            statusText = 'تمت الموافقة ✓';
            statusColor = 'var(--secondary)';
            actions = '<span style="color:var(--text-muted); font-size:0.8rem;">تمت المعالجة</span>';
        } else if (req.status === 'rejected') {
            statusText = 'مرفوض ❌';
            statusColor = 'var(--danger)';
            actions = '<span style="color:var(--text-muted); font-size:0.8rem;">تمت المعالجة</span>';
        }

        const createdAt = formatCairoDate(req.createdAt) + ' ' + formatCairoTime(req.createdAt);

        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${req.employeeName}</td>
                <td data-label="اليوم">${req.requestDate}</td>
                <td data-label="الموقع">${req.siteName}</td>
                <td data-label="المبلغ">${req.amount} ج.م</td>
                <td data-label="الملاحظة">${req.note || '-'}</td>
                <td data-label="التاريخ">${createdAt}</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
                <td data-label="الإجراءات" style="display:flex; gap:5px;">${actions}</td>
            </tr>
        `;
    });
}

async function handleAllowanceUpgrade(requestId, status) {
    const note = prompt(status === 'approved' ? "ملاحظة الموافقة (اختياري):" : "سبب الرفض:");
    if (status === 'rejected' && note === null) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const payload = {
            action: 'handleAllowanceRequest',
            requestId: requestId,
            status: status,
            adminId: hrSession.id,
            adminName: hrSession.name,
            adminNote: note || ''
        };

        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            fetchAllowanceRequests(true);
        } else {
            alert("خطأ: " + result.message);
        }
    } catch (e) {
        console.error(e);
        alert("فشل الاتصال بالسيرفر");
    }
    document.getElementById('loader').classList.add('hidden');
}

async function clearProcessedAllowances() {
    if(!confirm("هل أنت متأكد من مسح جميع طلبات زيادة البدلات التي تمت الموافقة عليها أو رفضها؟ هذا الإجراء لا يمكن التراجع عنه.")) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'clearProcessedAllowances' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            await fetchAllowanceRequests(true); // Refresh data
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

// ============================================
// LEAVE REQUESTS SYSTEM
// ============================================

async function fetchLeaveRequests(force = false) {
    if (!force && typeof allLeaveRequests !== 'undefined' && allLeaveRequests.length > 0) {
        renderLeaveRequestsTable(allLeaveRequests);
        return;
    }
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(`${API_URL}?action=getLeaveRequests`);
        const result = await res.json();
        if (result.success) {
            allLeaveRequests = result.data || [];
            renderLeaveRequestsTable(allLeaveRequests);
        }
    } catch (e) {
        console.error("Fetch Leave Requests error:", e);
    }
    document.getElementById('loader').classList.add('hidden');
}

function renderLeaveRequestsTable(data) {
    const tbody = document.getElementById('leaveRequestsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">لا توجد طلبات إجازة</td></tr>';
        return;
    }

    // Sort by status (pending first) then by date
    const sorted = [...data].sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    sorted.forEach(req => {
        let statusText = '';
        let statusColor = '';
        let actions = '';

        if (req.status === 'pending') {
            statusText = 'قيد الانتظار';
            statusColor = '#f59e0b';
            actions = `
                <button class="btn-primary" style="width:auto; padding:5px 10px; background:var(--secondary);" onclick="approveLeaveRequest('${req.id}')">موافقة</button>
                <button class="btn-danger" style="width:auto; padding:5px 10px; margin-right:5px;" onclick="rejectLeaveRequest('${req.id}')">رفض</button>
            `;
        } else if (req.status === 'approved') {
            statusText = 'تمت الموافقة';
            statusColor = '#10b981';
            actions = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color:var(--text-muted); font-size:0.85rem;">تمت الموافقة بتاريخ ${formatDate(req.approvedAt)}</span>
                    <button class="btn-danger" style="width:auto; padding:2px 8px; font-size:0.75rem; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" onclick="deleteLeaveRequest('${req.id}', '${req.employeeName}')">حذف 🗑️</button>
                </div>
            `;
        } else if (req.status === 'rejected') {
            statusText = 'مرفوض';
            statusColor = '#ef4444';
            actions = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color:var(--text-muted); font-size:0.85rem;">تم الرفض</span>
                    <button class="btn-danger" style="width:auto; padding:2px 8px; font-size:0.75rem; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);" onclick="deleteLeaveRequest('${req.id}', '${req.employeeName}')">حذف 🗑️</button>
                </div>
            `;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${req.employeeName}</strong></td>
            <td>${req.leaveDate}</td>
            <td>${req.reason}</td>
            <td>${formatDate(req.createdAt)}</td>
            <td><span style="color:${statusColor}; font-weight:bold;">${statusText}</span></td>
            <td>${actions}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteLeaveRequest(id, employeeName) {
    if (!confirm(`هل أنت متأكد من حذف طلب إجازة الموظف "${employeeName}"؟\nهذا الإجراء سيقوم بمسح الطلب نهائياً من النظام.`)) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'deleteLeaveRequest', id: id }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            await fetchLeaveRequests(true); // Refresh table
            await initDashboard(true);      // Sync dashboard data
        } else {
            alert('خطأ: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function approveLeaveRequest(id) {
    if (!confirm('هل أنت متأكد من الموافقة على طلب الإجازة هذا؟')) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'approveLeaveRequest', id: id, approvedBy: hrSession?.name || 'HR' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            await initDashboard(true);
        } else {
            alert('خطأ: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function rejectLeaveRequest(id) {
    const reason = prompt('سبب الرفض (اختياري):');
    if (reason === null) return; // User cancelled

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'rejectLeaveRequest', id: id, rejectionReason: reason }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            await initDashboard(true);
        } else {
            alert('خطأ: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function clearProcessedLeaveRequests() {
    if (!confirm('هل أنت متأكد من مسح جميع طلبات الإجازة التي تمت الموافقة عليها أو رفضها؟ هذا الإجراء لا يمكن التراجع عنه.')) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'clearProcessedLeaveRequests' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            await initDashboard(true);
        } else {
            alert('خطأ: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

// ============================================
// DEVICE MANAGEMENT FUNCTIONS
// ============================================

async function fetchDeviceChangeRequests() {
    const filter = document.getElementById('deviceRequestFilter')?.value || '';
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'getDeviceChangeRequests', status: filter }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            renderDeviceChangeRequests(result.data || []);
        }
    } catch (e) {
        console.error('Error fetching device change requests:', e);
    }
    document.getElementById('loader').classList.add('hidden');
}

function renderDeviceChangeRequests(requests) {
    const tbody = document.getElementById('deviceRequestsTableBody');
    tbody.innerHTML = '';
    
    if (requests.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">لا توجد طلبات</td></tr>`;
        return;
    }
    
    requests.forEach(req => {
        let statusText = '';
        let statusColor = '';
        let actions = '';
        
        if (req.status === 'pending') {
            statusText = 'قيد الانتظار';
            statusColor = '#f59e0b';
            actions = `
                <button class="btn-primary" style="width:auto; padding:5px 10px; font-size:0.8rem; background:var(--secondary);" onclick="approveDeviceChangeRequest('${req.id}')">موافقة</button>
                <button class="btn-danger" style="width:auto; padding:5px 10px; font-size:0.8rem;" onclick="rejectDeviceChangeRequest('${req.id}')">رفض</button>
            `;
        } else if (req.status === 'approved') {
            statusText = 'مقبول';
            statusColor = 'var(--secondary)';
            actions = '<span style="color:var(--text-muted); font-size:0.8rem;">تمت الموافقة</span>';
        } else if (req.status === 'rejected') {
            statusText = 'مرفوض';
            statusColor = 'var(--danger)';
            actions = '<span style="color:var(--text-muted); font-size:0.8rem;">تم الرفض</span>';
        }
        
        const createdAt = formatCairoDate(req.created_at) + ' ' + formatCairoTime(req.created_at);
        const oldDeviceShort = req.old_device_id ? req.old_device_id.substring(0, 20) + '...' : 'لا يوجد';
        const newDeviceShort = req.new_device_id ? req.new_device_id.substring(0, 20) + '...' : 'غير معروف';
        
        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${req.user_name || req.user_id}</td>
                <td data-label="الجهاز القديم" title="${req.old_device_id || ''}">${oldDeviceShort}</td>
                <td data-label="الجهاز الجديد" title="${req.new_device_id || ''}">${newDeviceShort}</td>
                <td data-label="نظام التشغيل">${req.new_os_type || '-'}</td>
                <td data-label="التاريخ">${createdAt}</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
                <td data-label="الإجراءات" style="display:flex; gap:5px;">${actions}</td>
            </tr>
        `;
    });
}

async function approveDeviceChangeRequest(requestId) {
    if (!confirm('هل أنت متأكد من الموافقة على تغيير الجهاز؟ سيتم إلغاء تفعيل الجهاز القديم وتفعيل الجهاز الجديد.')) return;
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'approveDeviceChangeRequest',
                requestId: requestId,
                adminId: hrSession.id,
                adminName: hrSession.name
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert('✅ ' + result.message);
            fetchDeviceChangeRequests();
            fetchAllDevices();
        } else {
            alert('❌ ' + result.message);
        }
    } catch (e) {
        console.error('Error approving device change:', e);
        alert('حدث خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function rejectDeviceChangeRequest(requestId) {
    const adminNote = prompt('سبب الرفض (اختياري):');
    if (adminNote === null) return; // Cancelled
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'rejectDeviceChangeRequest',
                requestId: requestId,
                adminNote: adminNote,
                adminId: hrSession.id,
                adminName: hrSession.name
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert('✅ ' + result.message);
            fetchDeviceChangeRequests();
        } else {
            alert('❌ ' + result.message);
        }
    } catch (e) {
        console.error('Error rejecting device change:', e);
        alert('حدث خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function fetchAllDevices() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'getAllDevices' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            renderDevicesTable(result.data || []);
        }
    } catch (e) {
        console.error('Error fetching devices:', e);
    }
    document.getElementById('loader').classList.add('hidden');
}

function renderDevicesTable(devices) {
    const tbody = document.getElementById('devicesTableBody');
    tbody.innerHTML = '';
    
    if (devices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">لا توجد أجهزة مسجلة</td></tr>`;
        return;
    }
    
    devices.forEach(device => {
        const statusText = device.is_active ? 'نشط' : 'غير نشط';
        const statusColor = device.is_active ? 'var(--secondary)' : 'var(--text-muted)';
        const createdAt = formatCairoDate(device.created_at) + ' ' + formatCairoTime(device.created_at);
        const deviceIdShort = device.device_id ? device.device_id.substring(0, 20) + '...' : '-';
        
        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${device.userName || device.user_id}</td>
                <td data-label="معرف الجهاز" title="${device.device_id || ''}">${deviceIdShort}</td>
                <td data-label="الطراز">${device.device_model || '-'}</td>
                <td data-label="نظام التشغيل">${device.os_type || '-'}</td>
                <td data-label="تاريخ التسجيل">${createdAt}</td>
                <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
                <td data-label="الإجراءات">
                    <button class="btn-danger" style="width:auto; padding:5px 10px; font-size:0.8rem;" onclick="deleteDevice('${device.id}', '${device.user_id}', '${device.device_id}')">حذف</button>
                </td>
            </tr>
        `;
    });
}

async function deleteDevice(deviceId, userId, deviceIdString) {
    if (!confirm('⚠️ هل أنت متأكد من حذف هذا الجهاز؟\n\nسيتم أيضاً حذف جميع سجلات الحضور المرتبطة بهذا الجهاز.\n\nهذا الإجراء لا يمكن التراجع عنه!')) return;

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'deleteDevice',
                deviceId: deviceId,
                userId: userId,
                deviceIdString: deviceIdString
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert('✅ ' + result.message);
            fetchAllDevices();
        } else {
            alert('❌ ' + result.message);
        }
    } catch (e) {
        console.error('Error deleting device:', e);
        alert('حدث خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

async function clearProcessedDeviceRequests() {
    if (!confirm('هل أنت متأكد من مسح جميع طلبات تغيير الجهاز التي تمت الموافقة عليها أو رفضها؟ هذا الإجراء لا يمكن التراجع عنه.')) return;
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'clearProcessedDeviceRequests' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert('✅ ' + result.message);
            await fetchDeviceChangeRequests();
        } else {
            alert('❌ ' + result.message);
        }
    } catch (e) {
        console.error('Error clearing processed device requests:', e);
        alert('حدث خطأ في الاتصال');
    }
    document.getElementById('loader').classList.add('hidden');
}

// ------ NOTIFICATIONS SYSTEM ------ //
let notificationsData = [];
let notificationsInterval = null;

function initNotifications() {
    // Fetch notifications immediately
    fetchNotifications();
    
    // Set up periodic fetching every 2 minutes
    if (notificationsInterval) clearInterval(notificationsInterval);
    notificationsInterval = setInterval(fetchNotifications, 2 * 60 * 1000);
}

async function fetchNotifications() {
    if (!hrSession) return;
    
    try {
        const res = await fetch(`${API_URL}?action=getNotifications&userRole=hr`);
        const result = await res.json();
        
        if (result.success) {
            notificationsData = result.notifications || [];
            updateNotificationBadge();
        }
    } catch (e) {
        console.error('Error fetching notifications:', e);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    
    const count = notificationsData.length;
    if (count > 0) {
        badge.innerText = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function toggleNotifications() {
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) return;
    
    const isHidden = dropdown.classList.contains('hidden');
    
    if (isHidden) {
        renderNotificationsList();
        dropdown.classList.remove('hidden');
    } else {
        dropdown.classList.add('hidden');
    }
}

function renderNotificationsList() {
    const list = document.getElementById('notificationList');
    if (!list) return;
    
    if (notificationsData.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">لا توجد إشعارات جديدة</p>';
        return;
    }
    
    list.innerHTML = '';
    notificationsData.forEach(notif => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:12px; border-bottom:1px solid var(--card-border); cursor:pointer; transition:background 0.2s;';
        item.onmouseover = () => item.style.background = 'rgba(255,255,255,0.05)';
        item.onmouseout = () => item.style.background = 'transparent';
        item.onclick = () => {
            markNotificationAsRead(notif.id);
            // Navigate to relevant tab based on notification type
            if (notif.type === 'leave_request') showTab('leaveRequests');
            else if (notif.type === 'site_request') showTab('siteRequests');
            else if (notif.type === 'allowance_request') showTab('allowanceRequests');
        };
        
        const timeAgo = formatTimeAgo(notif.createdAt);
        const icon = getNotificationIcon(notif.type);
        
        item.innerHTML = `
            <div style="display:flex; align-items:flex-start; gap:10px;">
                <span style="font-size:20px;">${icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; margin-bottom:4px;">${notif.title}</div>
                    <div style="font-size:13px; color:var(--text-muted); margin-bottom:4px;">${notif.message}</div>
                    <div style="font-size:11px; color:var(--secondary);">${timeAgo}</div>
                </div>
                <span style="width:8px; height:8px; background:var(--secondary); border-radius:50%; flex-shrink:0;"></span>
            </div>
        `;
        list.appendChild(item);
    });
}

function getNotificationIcon(type) {
    const icons = {
        'leave_request': '📅',
        'site_request': '📍',
        'allowance_request': '💰',
        'default': '📢'
    };
    return icons[type] || icons['default'];
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'الآن';
    if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
    if (diffHours < 24) return `منذ ${diffHours} ساعة`;
    if (diffDays === 1) return 'أمس';
    return `منذ ${diffDays} يوم`;
}

async function markNotificationAsRead(notificationId) {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'markNotificationAsRead', notificationId: notificationId }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        
        if (result.success) {
            // Remove from local data
            notificationsData = notificationsData.filter(n => n.id !== notificationId);
            updateNotificationBadge();
            renderNotificationsList();
        }
    } catch (e) {
        console.error('Error marking notification as read:', e);
    }
}

async function markAllNotificationsAsRead() {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'markAllNotificationsAsRead', userRole: 'hr' }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        
        if (result.success) {
            notificationsData = [];
            updateNotificationBadge();
            renderNotificationsList();
        }
    } catch (e) {
        console.error('Error marking all notifications as read:', e);
    }
}

// Close notifications dropdown when clicking outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('notificationContainer');
    const dropdown = document.getElementById('notificationDropdown');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});
