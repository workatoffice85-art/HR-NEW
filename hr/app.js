const API_URL = '/api/exec';
// const OLD_BACKUP_API = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let hrSession = null;
let allAttendanceData = [];
let allEmployees = [];
let allSites = [];
let allSiteRequests = [];
let allHolidays = [];
let appSettings = {};
let latesChartInstance = null;
let parseMapLinkTimer = null;
let parseMapLinkRequestId = 0;
let isInitialDataLoaded = false;
let attendancePage = 0;
const attendanceLimit = 50;
let attendanceTotal = 0;

async function callApi(payload, method = 'POST') {
    const headers = { 
        'Content-Type': 'text/plain' 
    };
    const token = localStorage.getItem('hrToken');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    let url = API_URL;
    let fetchOptions = { method: method, headers: headers };

    if (method === 'GET') {
        const params = new URLSearchParams(payload).toString();
        url = `${API_URL}?${params}`;
    } else {
        fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, fetchOptions);
    return await response.json();
}

async function callApi(payload, method = 'POST') {
    const headers = { 
        'Content-Type': 'text/plain' 
    };
    const token = localStorage.getItem('hrToken');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    let url = API_URL;
    let fetchOptions = { method: method, headers: headers };

    if (method === 'GET') {
        const params = new URLSearchParams(payload).toString();
        url = `${API_URL}?${params}`;
    } else {
        fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, fetchOptions);
    return await response.json();
}

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
    if (!email || !pass) return showToast("أدخل بيانات الدخول", "error");

    const btn = document.querySelector('#hrLoginSection .auth-form button');
    setLoading(btn, true);

    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', identifier: email, password: pass, role: 'hr' }),
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
=======
        const result = await callApi({ action: 'login', identifier: email, password: pass, role: 'hr' });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action: 'login', identifier: email, password: pass, role: 'hr' });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        
        if (result.success) {
            localStorage.setItem('hrToken', result.token);
            localStorage.setItem('hrSession', JSON.stringify(result.data));
            showToast("تم تسجيل الدخول بنجاح", "success");
            checkSession();
        } else {
            showToast(result.message || 'خطأ في بيانات الدخول أو لا تملك صلاحيات HR', 'error');
        }
    } catch (e) {
        showToast('فشل الاتصال بالخادم: ' + e.message, 'error');
    }
    setLoading(btn, false);
}

function logout() {
    localStorage.removeItem('hrSession');
    location.reload();
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    
    const targetTab = document.getElementById('tab-' + tabName);
    if (targetTab) targetTab.classList.remove('hidden');
    
    // Highlight the active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        const onclickAttr = link.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(`'${tabName}'`)) {
            link.classList.add('active');
        }
    });

    localStorage.setItem('hrActiveTab', tabName);
    
    if (tabName === 'attendance') fetchAttendance(0);
    if (tabName === 'employees') fetchEmployees();
    if (tabName === 'sites') fetchSites();
    if (tabName === 'siteRequests') fetchSiteRequests();
    if (tabName === 'holidays') fetchHolidays();
    if (tabName === 'reports') generateReport();
    if (tabName === 'employeeDetails') initEmployeeDetailedTab();
    if (tabName === 'settings') fetchSettings();

    // Close sidebar on mobile after clicking a link
    const sidebar = document.querySelector('.sidebar');
    if (window.innerWidth <= 768 && sidebar && sidebar.classList.contains('active')) {
        toggleSidebar();
    }
}

async function initDashboard(forceRefresh = false) {
    if (isInitialDataLoaded && !forceRefresh) return;
    
    const kpis = document.querySelectorAll('.kpi-value');
    kpis.forEach(el => el.classList.add('skeleton'));

    document.getElementById('loader').classList.remove('hidden');
    const token = localStorage.getItem('hrToken');
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(`${API_URL}?action=getDashboardData`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
=======
        const result = await callApi({ action: 'getDashboardData' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action: 'getDashboardData' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        
        if (result.success) {
            allAttendanceData = result.attendance || [];
            allEmployees = result.employees || [];
            allSites = result.sites || [];
            allSiteRequests = result.siteRequests || [];
            allHolidays = result.holidays || [];
            appSettings = result.settings || {};
            
            isInitialDataLoaded = true;
            
            // Render the current active tab
            const activeTab = localStorage.getItem('hrActiveTab') || 'attendance';
            renderActiveTab(activeTab);
        }
    } catch (e) {
        console.error("Initial load failed", e);
    }
    kpis.forEach(el => el.classList.remove('skeleton'));
    document.getElementById('loader').classList.add('hidden');
}

function renderActiveTab(tabName) {
    if (tabName === 'attendance') renderAttendanceTable(allAttendanceData);
    if (tabName === 'employees') renderEmployeesTable(allEmployees);
    if (tabName === 'sites') renderSitesTable(allSites);
    if (tabName === 'siteRequests') renderRequestsTable(allSiteRequests);
    if (tabName === 'allowanceRequests') renderAllowanceRequestsTable(allAttendanceData);
    if (tabName === 'holidays') renderHolidaysTable(allHolidays);
    if (tabName === 'settings') renderSettings(appSettings);
}

async function fetchAttendance(page = 0) {
    attendancePage = page;
    const offset = attendancePage * attendanceLimit;
    
    document.getElementById('loader').classList.remove('hidden');
    const token = localStorage.getItem('hrToken');
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(`${API_URL}?action=getAttendance&limit=${attendanceLimit}&offset=${offset}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
=======
        const result = await callApi({ action: 'getAttendance' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action: 'getAttendance' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            allAttendanceData = result.data;
            attendanceTotal = result.total || 0;
            renderAttendanceTable(allAttendanceData);
            updatePaginationUI();
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

function updatePaginationUI() {
    const pagination = document.getElementById('attendancePagination');
    const info = document.getElementById('attendancePageInfo');
    if (!pagination || !info) return;

    const totalPages = Math.ceil(attendanceTotal / attendanceLimit);
    if (attendanceTotal <= attendanceLimit) {
        pagination.classList.add('hidden');
    } else {
        pagination.classList.remove('hidden');
        info.innerText = `صفحة ${attendancePage + 1} من ${totalPages}`;
    }
}

function nextAttendancePage() {
    if ((attendancePage + 1) * attendanceLimit < attendanceTotal) {
        fetchAttendance(attendancePage + 1);
    }
}

function prevAttendancePage() {
    if (attendancePage > 0) {
        fetchAttendance(attendancePage - 1);
    }
}

async function refreshData() {
    await initDashboard(true);
}

function renderAttendanceTable(data) {
    const filterDate = document.getElementById('attendanceDateFilter').value;
    const tbody = document.getElementById('attendanceTableBody');
    tbody.innerHTML = '';
    
    let filtered = data;
    if (filterDate) {
        filtered = data.filter(record => {
            const d = new Date(record.checkIn);
            return d.toISOString().split('T')[0] === filterDate;
        });
    }

<<<<<<< HEAD
<<<<<<< HEAD
    filtered.forEach(record => {
=======
=======
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
    [...filtered].reverse().forEach(record => {
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        const cInObj = new Date(record.checkIn);
        const checkInTime = !isNaN(cInObj) ? cInObj.toLocaleString('ar-EG') : (record.checkIn || '-');
        
        let checkOutTime = 'لم ينصرف بعد';
        if (record.checkOut) {
            const cOutObj = new Date(record.checkOut);
            checkOutTime = !isNaN(cOutObj) ? cOutObj.toLocaleString('ar-EG') : (record.checkOut || '-');
        }
        
<<<<<<< HEAD
<<<<<<< HEAD
        let statusText = 'حاضر';
        let statusColor = 'var(--secondary)';
        if (record.status === 'late') { statusText = 'متأخر'; statusColor = 'var(--danger)'; }
        else if (record.status === 'overtime') { statusText = 'عمل إضافي'; statusColor = '#3b82f6'; }

        const statusSpan = document.createElement('span');
        statusSpan.textContent = statusText;
        statusSpan.style.color = statusColor;

        const row = createSafeRow([
            record.employeeName,
            record.siteName,
            checkInTime,
            checkOutTime,
            record.totalHours && !isNaN(parseFloat(record.totalHours)) ? parseFloat(record.totalHours).toFixed(2) + ' ساعات' : '-',
            (record.transportPrice || 0) + ' ج.م',
            statusSpan
        ]);
        
        // Add accessibility labels for mobile
        const labels = ["الموظف", "الموقع", "وقت الحضور", "وقت الانصراف", "إجمالي الساعات", "بدل الانتقال", "الحالة"];
        row.querySelectorAll('td').forEach((td, i) => td.setAttribute('data-label', labels[i]));
        
        tbody.appendChild(row);
=======
=======
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        const statusMeta = getStatusMeta(record.status);
        const extra = (record.extraAmountStatus === 'approved') ? parseFloat(record.requestedExtraAmount || 0) : 0;
        const totalPayable = (parseFloat(record.transportPrice || 0) + parseFloat(record.overtimeAmount || 0) + extra).toFixed(2);

        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${record.employeeName}</td>
                <td data-label="الموقع">${record.siteName}</td>
                <td data-label="وقت الحضور" dir="ltr">${checkInTime}</td>
                <td data-label="وقت الانصراف" dir="ltr">${checkOutTime}</td>
                <td data-label="إجمالي المستحق">${totalPayable} ج.م</td>
                <td data-label="الملاحظات">${record.note || '-'}</td>
                <td data-label="الحالة"><span style="color:${statusMeta.color}">${statusMeta.text}</span></td>
            </tr>
        `;
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
    });
}

function getWorkingDaysCount(startDate, endDate) {
    let workingDaysCount = 0;
    const tempDate = new Date(startDate);
    tempDate.setHours(0, 0, 0, 0);

    const finalDate = new Date(endDate);
    finalDate.setHours(23, 59, 59, 999);

    while (tempDate <= finalDate) {
        if (tempDate.getDay() !== 5 && tempDate.getDay() !== 6) {
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

function calculateUniqueDailyTransport(records) {
    const dailyTransport = {};
    records.forEach(record => {
        const dateObj = new Date(record.checkIn);
        if (Number.isNaN(dateObj.getTime())) return;

        const dayKey = `${String(record.employeeId || '')}|${dateObj.toDateString()}`;
        const transportValue = toTransportNumber(record.transportPrice);

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
    return { text: 'حاضر', color: 'var(--secondary)' };
}

function resetEmployeeDetailedReportView(message) {
    document.getElementById('employeeDetailPresent').innerText = '0';
    document.getElementById('employeeDetailAbsent').innerText = '0';
    document.getElementById('employeeDetailLate').innerText = '0';
    document.getElementById('employeeDetailTransport').innerText = '0.00';
    document.getElementById('employeeDetailMeta').innerText = message || 'اختر موظفًا وحدد الفترة الزمنية ثم اضغط "عرض التقرير".';

    const tbody = document.getElementById('employeeDetailTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'employee-report-empty';
    td.textContent = message || 'لا توجد بيانات معروضة بعد.';
    tr.appendChild(td);
    tbody.appendChild(tr);
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
        const checkInDate = new Date(record.checkIn);
        if (isNaN(checkInDate)) return false;
        return String(record.employeeId) === String(employeeId) && checkInDate >= startDate && checkInDate <= endDate;
    });

    const sortedRecords = [...employeeRecords].sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
    const presentDates = new Set();
    const lateDates = new Set();
    let totalTransport = 0;

    sortedRecords.forEach(record => {
        const recordDate = new Date(record.checkIn);
        const dateKey = !isNaN(recordDate) ? recordDate.toDateString() : null;
        if (dateKey) {
            presentDates.add(dateKey);
            if (record.status === 'late') lateDates.add(dateKey);
        }

    });

    totalTransport = calculateUniqueDailyTransport(sortedRecords);

    const workingDaysCount = getWorkingDaysCount(startDate, endDate);
    const daysPresent = presentDates.size;
    const daysAbsent = Math.max(workingDaysCount - daysPresent, 0);

    document.getElementById('employeeDetailPresent').innerText = String(daysPresent);
    document.getElementById('employeeDetailAbsent').innerText = String(daysAbsent);
    document.getElementById('employeeDetailLate').innerText = String(lateDates.size);
    document.getElementById('employeeDetailTransport').innerText = totalTransport.toFixed(2);

    const selectedLabel = employeeSelect.options[employeeSelect.selectedIndex]
        ? employeeSelect.options[employeeSelect.selectedIndex].textContent
        : employeeId;
    const employeeName = selectedLabel.replace(/\s*\(.+\)\s*$/, '').trim() || selectedLabel;
    document.getElementById('employeeDetailMeta').innerText =
        `الموظف: ${employeeName} | الفترة: ${startDate.toLocaleDateString('ar-EG')} - ${endDate.toLocaleDateString('ar-EG')} | عدد العمليات: ${sortedRecords.length}`;

    const tbody = document.getElementById('employeeDetailTableBody');
    if (sortedRecords.length === 0) {
        tbody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'employee-report-empty';
        td.textContent = 'لا توجد عمليات لهذا الموظف خلال الفترة المحددة.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    tbody.innerHTML = '';
    sortedRecords.forEach(record => {
        const checkInObj = new Date(record.checkIn);
        const dateText = !isNaN(checkInObj) ? checkInObj.toLocaleDateString('ar-EG') : '-';
        const checkInText = !isNaN(checkInObj)
            ? checkInObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            : (record.checkIn || '-');

        let checkOutText = 'لم ينصرف بعد';
        if (record.checkOut) {
            const checkOutObj = new Date(record.checkOut);
            checkOutText = !isNaN(checkOutObj)
                ? checkOutObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                : (record.checkOut || '-');
        }

<<<<<<< HEAD
<<<<<<< HEAD
        const statusMeta = getStatusMeta(record.status);
        const statusSpan = document.createElement('span');
        statusSpan.style.color = statusMeta.color;
        statusSpan.textContent = statusMeta.text;

        const parsedHours = parseFloat(record.totalHours);
        const hoursText = !isNaN(parsedHours) ? `${parsedHours.toFixed(2)} ساعة` : '-';
        const parsedTransport = parseFloat(record.transportPrice || 0);
        const transportText = `${isNaN(parsedTransport) ? 0 : parsedTransport.toFixed(2)} ج.م`;

        const row = createSafeRow([
            dateText,
            record.siteName || '-',
            checkInText,
            checkOutText,
            statusSpan,
            hoursText,
            transportText
        ]);
        
        const labels = ["التاريخ", "الموقع", "وقت الحضور", "وقت الانصراف", "الحالة", "الساعات", "البدل"];
        row.querySelectorAll('td').forEach((td, i) => td.setAttribute('data-label', labels[i]));
        tbody.appendChild(row);
=======
=======
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        const otAmount = parseFloat(record.overtimeAmount || 0);
        
        tbody.innerHTML += `
            <tr>
                <td data-label="التاريخ">${dateText}</td>
                <td data-label="الموقع">${record.siteName || '-'}</td>
                <td data-label="وقت الحضور" dir="ltr">${checkInText}</td>
                <td data-label="وقت الانصراف" dir="ltr">${checkOutText}</td>
                <td data-label="الحالة"><span style="color:${statusMeta.color}">${statusMeta.text}</span></td>
                <td data-label="البدل">${transportText}</td>
                <td data-label="الإضافي">${otAmount > 0 ? otAmount.toFixed(2) + ' ج.م' : '-'}</td>
                <td data-label="الملاحظات">${record.note || '-'}</td>
            </tr>
        `;
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
    });
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

    // Filter records for the range
    const filtered = allAttendanceData.filter(record => {
        const d = new Date(record.checkIn);
        return d >= startDate && d <= endDate;
    });

    const reportAcc = {};

    filtered.forEach(record => {
        const empId = record.employeeId;
        const recordDate = new Date(record.checkIn).toDateString(); 
        
        if(!reportAcc[empId]) {
             reportAcc[empId] = {
                 name: record.employeeName,
                 uniqueDates: new Set(),
                 lateDates: new Set(),
                 transportByDate: {},
                 daysPresent: 0,
                 lates: 0,
                 overtime: 0,
                 totalTransport: 0,
                 totalOvertimeAmount: 0,
                 totalExtraAllowanceAmount: 0
             };
        }
        
        const empStats = reportAcc[empId];
        
        if (!empStats.uniqueDates.has(recordDate)) {
            empStats.uniqueDates.add(recordDate);
            empStats.daysPresent += 1;
        }

        if(record.status === 'late') {
            if (!empStats.lateDates.has(recordDate)) {
                empStats.lateDates.add(recordDate);
                empStats.lates += 1;
            }
        }
        if(record.status === 'overtime') empStats.overtime += 1;
        if(record.overtimeAmount) empStats.totalOvertimeAmount += parseFloat(record.overtimeAmount);
        if(record.extraAmountStatus === 'approved' && record.requestedExtraAmount) {
            empStats.totalExtraAllowanceAmount += parseFloat(record.requestedExtraAmount);
        }
        const transportValue = toTransportNumber(record.transportPrice);
        if (!(recordDate in empStats.transportByDate)) {
            empStats.transportByDate[recordDate] = transportValue;
        } else if (transportValue > empStats.transportByDate[recordDate]) {
            empStats.transportByDate[recordDate] = transportValue;
        }
    });

    Object.keys(reportAcc).forEach(empId => {
        const map = reportAcc[empId].transportByDate;
        reportAcc[empId].totalTransport = Object.values(map).reduce((sum, value) => sum + value, 0);
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

<<<<<<< HEAD
        const absentSpan = document.createElement('span');
        if (absentDays > 0) {
            absentSpan.style.color = 'var(--danger)';
            absentSpan.textContent = absentDays + ' أيام';
        } else {
            absentSpan.textContent = '0 أيام';
        }

        const lateSpan = document.createElement('span');
        if (data.lates > 0) {
            lateSpan.style.color = 'var(--danger)';
            lateSpan.textContent = data.lates + ' مرات';
        } else {
            lateSpan.textContent = '0 مرات';
        }

        const otSpan = document.createElement('span');
        otSpan.style.color = '#3b82f6';
        otSpan.textContent = (data.overtime || 0) + ' أيام';

        const row = createSafeRow([
            empId,
            data.name,
            data.daysPresent + ' أيام',
            absentSpan,
            lateSpan,
            otSpan,
            data.totalTransport.toFixed(2) + ' ج.م',
            data.totalHours.toFixed(2) + ' ساعات'
        ]);
        
        const labels = ["ID الموظف", "اسم الموظف", "أيام الحضور", "أيام الغياب", "التأخير", "العمل الإضافي", "بدل الانتقال", "إجمالي الساعات"];
        row.querySelectorAll('td').forEach((td, i) => td.setAttribute('data-label', labels[i]));
        tbody.appendChild(row);
=======
        tbody.innerHTML += `
            <tr>
                <td data-label="ID الموظف">${empId}</td>
                <td data-label="اسم الموظف">${data.name}</td>
                <td data-label="أيام الحضور">${data.daysPresent} أيام</td>
                <td data-label="أيام الغياب"><span style="color:${absentDays > 0 ? 'var(--danger)' : 'inherit'}">${absentDays > 0 ? absentDays : 0} أيام</span></td>
                <td data-label="التأخير"><span style="color:${data.lates > 0 ? 'var(--danger)' : 'inherit'}">${data.lates} مرات</span></td>
                <td data-label="العمل الإضافي"><span style="color:#3b82f6">${data.overtime || 0} أيام</span></td>
                <td data-label="إجمالي المستحق">${(data.totalTransport + (data.totalOvertimeAmount || 0) + (data.totalExtraAllowanceAmount || 0)).toFixed(2)} ج.م</td>
            </tr>
        `;
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
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
    const tbody = document.getElementById('employeesTableBody');
    if (tbody) tbody.classList.add('skeleton');
    
    document.getElementById('loader').classList.remove('hidden');
    const token = localStorage.getItem('hrToken');
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(`${API_URL}?action=getEmployees`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
=======
        const result = await callApi({ action: 'getEmployees' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action: 'getEmployees' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            allEmployees = result.data;
            populateEmployeeDetailEmployees();
            renderEmployeesTable(allEmployees);
        }
    } catch(e) { console.error(e); }
    if (tbody) tbody.classList.remove('skeleton');
    document.getElementById('loader').classList.add('hidden');
}

function renderEmployeesTable(data) {
    const tbody = document.getElementById('employeesTableBody');
    tbody.innerHTML = '';
    data.forEach(record => {
        const actionsCell = document.createElement('div');
        actionsCell.style.display = 'flex';
        actionsCell.style.gap = '8px';
        actionsCell.style.justifyContent = 'center';
        actionsCell.style.padding = '10px';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-primary';
        editBtn.style.padding = '5px 12px';
        editBtn.style.fontSize = '0.85rem';
        editBtn.style.width = 'auto';
        editBtn.textContent = 'تعديل ✏️';
        editBtn.onclick = () => editEmployee(record.id);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-danger';
        delBtn.style.cssText = 'padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);';
        delBtn.textContent = 'حذف 🗑️';
        delBtn.onclick = () => deleteEntity('deleteEmployee', record.id, record.name);

        actionsCell.appendChild(editBtn);
        actionsCell.appendChild(delBtn);

        const row = createSafeRow([
            record.name,
            record.email,
            record.phone || '-',
            record.role,
            record.faceDescriptor ? '✅ مسجل' : '❌ لا يوجد',
            actionsCell
        ]);
        
        const labels = ["الاسم", "البريد", "الهاتف", "الصلاحية", "البصمة", "الإجراءات"];
        row.querySelectorAll('td').forEach((td, i) => td.setAttribute('data-label', labels[i]));
        tbody.appendChild(row);
    });
}

async function fetchSites(force = false) {
    if (!force && allSites.length) {
        renderSitesTable(allSites);
        return;
    }
    const tbody = document.getElementById('sitesTableBody');
    if (tbody) tbody.classList.add('skeleton');

    document.getElementById('loader').classList.remove('hidden');
    const token = localStorage.getItem('hrToken');
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(`${API_URL}?action=getSites`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
=======
        const result = await callApi({ action: 'getSites' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action: 'getSites' }, 'GET');
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            allSites = result.data;
            renderSitesTable(allSites);
        }
    } catch(e) { console.error("Fetch Sites Error:", e); }
    if (tbody) tbody.classList.remove('skeleton');
    document.getElementById('loader').classList.add('hidden');
}

// Duplicate renderSitesTable removed.

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
    document.getElementById('empRole').value = emp.role;
    document.getElementById('empTransportPrice').value = emp.transportPrice || 0;
    document.getElementById('empSalary').value = emp.salary || 0;
    
    // Assigned sites (can keep for compatibility or just use for initialization)
    const assigned = Array.isArray(emp.assignedSites) ? emp.assignedSites : (emp.assignedSites ? String(emp.assignedSites).split(',') : []);
    document.getElementById('empSites').value = assigned.join(',');
    
    await openEmployeeModal('edit', emp);
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
    if(!(await showConfirm(`هل أنت متأكد من حذف "${name}"؟ لا يمكن التراجع عن هذا الإجراء.`))) return;
    
    const token = localStorage.getItem('hrToken');
    setLoading(document.body, true);
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify({ action, id }), 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            } 
        });
        const result = await res.json();
=======
        const result = await callApi({ action, id });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action, id });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            showToast(`تم حذف ${name} بنجاح`, "success");
            if(action === 'deleteEmployee') fetchEmployees();
            else fetchSites();
        } else showToast("خطأ في الحذف: " + result.message, "error");
    } catch(e) { showToast("خطأ في الاتصال", "error"); }
    setLoading(document.body, false);
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
        document.getElementById('empTransportPrice').value = 0;
        document.getElementById('empSalary').value = 0;
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
        div.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px; padding:5px; border-bottom:1px solid rgba(255,255,255,0.05);';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'site-checkbox';
        checkbox.value = site.id;
        checkbox.checked = isAssigned;
        checkbox.style.cssText = 'width:18px; height:18px;';

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'flex:1; font-size:0.9rem;';
        nameSpan.textContent = site.name;

        const priceContainer = document.createElement('div');
        priceContainer.style.cssText = 'display:flex; align-items:center; gap:5px;';

        const priceInput = document.createElement('input');
        priceInput.type = 'number';
        priceInput.className = 'site-price-input';
        priceInput.setAttribute('data-site-id', site.id);
        priceInput.value = price;
        priceInput.disabled = !isAssigned;
        priceInput.style.cssText = 'width:70px; padding:4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--card-border); color:white; font-size:0.85rem;';

        const currencySpan = document.createElement('span');
        currencySpan.style.cssText = 'font-size:0.75rem; color:var(--text-muted);';
        currencySpan.textContent = 'ج.م';

        priceContainer.appendChild(priceInput);
        priceContainer.appendChild(currencySpan);

        div.appendChild(checkbox);
        div.appendChild(nameSpan);
        div.appendChild(priceContainer);

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
    const transportPrice = parseFloat(document.getElementById('empTransportPrice').value) || 0;
    const salary = parseFloat(document.getElementById('empSalary').value) || 0;
    
    // Collect sites and allowances
    const selectedSites = [];
    const siteAllowances = [];
    
    document.querySelectorAll('#empSitesContainer > div').forEach(div => {
        const checkbox = div.querySelector('.site-checkbox');
        const priceInput = div.querySelector('.site-price-input');
        if (checkbox && checkbox.checked) {
            const siteId = checkbox.value;
            const price = parseFloat(priceInput.value) || 0;
            selectedSites.push(siteId);
            siteAllowances.push({ siteId, transportPrice: price });
        }
    });

    if(!phone) return showToast("أدخل رقم الهاتف", "error");
    if(!name || !email) return showToast("أكمل البيانات", "error");
    
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
        transportPrice: transportPrice,
        salary: salary
    };
    
    const token = localStorage.getItem('hrToken');
    const btn = document.querySelector('#employeeModal .btn-primary');
    setLoading(btn, true);
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify(payload), 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            } 
        });
        const result = await res.json();
=======
        const result = await callApi(payload);
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi(payload);
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            if (autoGeneratedPassword) {
                showToast(`تم إنشاء الموظف. كلمة المرور المؤقتة: ${autoGeneratedPassword}`, 'info', 10000);
            } else {
                showToast('تم حفظ بيانات الموظف بنجاح', 'success');
            }
            closeEmployeeModal();
            fetchEmployees();
        } else showToast("خطأ في الحفظ: " + result.message, 'error');
    } catch(e) {
        showToast("خطأ في الاتصال: " + e.message, 'error');
    }
    setLoading(btn, false);
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
            const result = await callApi({ action: 'resolveMapLink', link: link });
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

function renderSitesTable(data) {
    const tbody = document.getElementById('sitesTableBody');
    tbody.innerHTML = '';
    data.forEach(record => {
        const actionsCell = document.createElement('div');
        actionsCell.style.cssText = 'display:flex; gap:8px; justify-content:center; padding:10px;';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-primary';
        editBtn.style.cssText = 'padding:5px 12px; font-size:0.85rem; width:auto;';
        editBtn.textContent = 'تعديل ✏️';
        editBtn.onclick = () => editSite(record.id);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-danger';
        delBtn.style.cssText = 'padding:5px 12px; font-size:0.85rem; width:auto; background:rgba(239,68,68,0.1); border:1px solid var(--danger); color:var(--danger);';
        delBtn.textContent = 'حذف 🗑️';
        delBtn.onclick = () => deleteEntity('deleteSite', record.id, record.name);

        actionsCell.appendChild(editBtn);
        actionsCell.appendChild(delBtn);

        const mapLink = document.createElement('a');
        if (record.mapLink) {
            mapLink.href = record.mapLink;
            mapLink.target = '_blank';
            mapLink.style.cssText = 'color:var(--primary); text-decoration:underline;';
            mapLink.textContent = 'فتح الرابط 📍';
        } else {
            mapLink.textContent = 'لا يوجد';
        }

        const row = createSafeRow([
            record.name,
            record.latitude,
            record.longitude,
            record.radius + ' م',
            mapLink,
            actionsCell
        ]);
        
        const labels = ["اسم الموقع", "خط العرض", "خط الطول", "النطاق", "رابط الموقع", "الإجراءات"];
        row.querySelectorAll('td').forEach((td, i) => td.setAttribute('data-label', labels[i]));
        tbody.appendChild(row);
    });
}

async function saveSite() {
    const editId = document.getElementById('editSiteId').value;
    const name = document.getElementById('siteName').value.trim();
    const lat = document.getElementById('siteLat').value.trim();
    const lng = document.getElementById('siteLng').value.trim();
    const radius = document.getElementById('siteRadius').value.trim();
    
    if(!name || !lat || !lng || !radius) return showToast("الرجاء إكمال كافة البيانات", "error");
    
    const payload = {
        action: editId ? 'updateSite' : 'saveSite',
        id: editId || Math.floor(10000 + Math.random() * 90000), 
        name: name, latitude: lat, longitude: lng, radius: radius,
        mapLink: document.getElementById('siteMapLink').value.trim()
    };
    
    const token = localStorage.getItem('hrToken');
    const btn = document.querySelector('#siteModal .btn-primary');
    setLoading(btn, true);
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(API_URL, { 
            method: 'POST', 
            body: JSON.stringify(payload), 
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            } 
        });
        const result = await res.json();
=======
        const result = await callApi(payload);
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi(payload);
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            showToast('تم حفظ بيانات الموقع بنجاح', 'success');
            closeSiteModal();
            fetchSites();
            // Clear inputs
            document.getElementById('siteName').value = '';
            document.getElementById('siteMapLink').value = '';
            document.getElementById('siteLat').value = '';
            document.getElementById('siteLng').value = '';
            document.getElementById('siteRadius').value = '20';
        } else { showToast("خطأ في الحفظ: " + (result.message||''), 'error'); }
    } catch(e) { showToast("خطأ في الاتصال: " + e.message, 'error'); }
    setLoading(btn, false);
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
        const result = await callApi({ action: 'getSettings' }, 'GET');
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
}

async function saveSettings() {
    const workStartTime = document.getElementById('setWorkStartTime').value;
    const workEndTime = document.getElementById('setWorkEndTime').value;
    const reportEmails = document.getElementById('setReportEmails').value;
    const dailyEnabled = document.getElementById('setDailyReport').checked;
    const monthlyEnabled = document.getElementById('setMonthlyReport').checked;

    setLoading('tab-settings', true);
    try {
        const payload = {
            action: 'updateSettings',
            settings: {
                workStartTime: workStartTime,
                workEndTime: workEndTime,
                reportEmails: reportEmails,
                dailyReportEnabled: dailyEnabled ? "true" : "false",
                monthlyReportEnabled: monthlyEnabled ? "true" : "false"
            }
        };

<<<<<<< HEAD
<<<<<<< HEAD
        const token = localStorage.getItem('hrToken');
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const result = await res.json();
=======
        const result = await callApi(payload);
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi(payload);
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        
        if (result.success) {
            showToast("✅ تم حفظ الإعدادات بنجاح", "success");
        } else {
            showToast("❌ خطأ: " + result.message, "error");
        }
    } catch (e) {
        showToast("حدث خطأ في الاتصال", "error");
    }
    setLoading('tab-settings', false);
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

// ------ SITE REQUESTS LOGIC ------ //
async function fetchSiteRequests(force = false) {
    if (!force && allSiteRequests.length) {
        renderSiteRequestsTable(allSiteRequests);
        return;
    }
    const tbody = document.getElementById('siteRequestsTableBody');
    if (tbody) tbody.classList.add('skeleton');

    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'getSiteRequests' }, 'GET');
        if(result.success) {
            allSiteRequests = result.data;
            renderSiteRequestsTable(allSiteRequests);
        }
    } catch(e) { console.error("Fetch Site Requests error:", e); }
    if (tbody) tbody.classList.remove('skeleton');
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
        
        const actionsCell = document.createElement('div');
        if (canManageRequest) {
            actionsCell.style.display = 'flex';
            actionsCell.style.gap = '8px';
            
            const appBtn = document.createElement('button');
            appBtn.className = 'btn-primary';
            appBtn.style.cssText = 'padding:5px 12px; font-size:0.85rem; width:auto; background:var(--secondary);';
            appBtn.textContent = 'موافقة ✓';
            appBtn.onclick = () => approveRequest(req.id, req.suggestedName);

            const rejBtn = document.createElement('button');
            rejBtn.className = 'btn-danger';
            rejBtn.style.cssText = 'padding:5px 12px; font-size:0.85rem; width:auto;';
            rejBtn.textContent = 'رفض ✕';
            rejBtn.onclick = () => rejectRequest(req.id);

            actionsCell.appendChild(appBtn);
            actionsCell.appendChild(rejBtn);
        } else {
            actionsCell.textContent = '-';
        }

        const mapLink = document.createElement('a');
        if (req.mapLink) {
            mapLink.href = req.mapLink;
            mapLink.target = '_blank';
            mapLink.style.cssText = 'color:var(--primary); text-decoration:underline;';
            mapLink.textContent = 'فتح الرابط 📍';
        } else {
            mapLink.textContent = 'لا يوجد';
        }

        const receiptLink = document.createElement('a');
        if (req.receiptUrl) {
            receiptLink.href = req.receiptUrl;
            receiptLink.target = '_blank';
            receiptLink.style.cssText = 'color:var(--secondary); text-decoration:underline;';
            receiptLink.textContent = req.receiptName || 'عرض المرفق';
        } else {
            receiptLink.textContent = '-';
        }

        const statusSpan = document.createElement('span');
        statusSpan.textContent = statusText;
        statusSpan.style.color = statusColor;

        const dateObj = req.timestamp ? new Date(req.timestamp) : null;
        const createdStr = (dateObj && !isNaN(dateObj)) ? dateObj.toLocaleString('ar-EG') : (req.timestamp || '-');
        const approvedObj = req.approvedAt ? new Date(req.approvedAt) : null;
        const approvedStr = (approvedObj && !isNaN(approvedObj)) ? approvedObj.toLocaleString('ar-EG') : '';
        
        const dateCell = document.createElement('div');
        dateCell.textContent = createdStr;
        if (approvedStr) {
            const small = document.createElement('small');
            small.style.cssText = 'display:block; color:var(--text-muted);';
            small.textContent = `اعتماد: ${approvedStr}`;
            dateCell.appendChild(small);
        }

        const row = createSafeRow([
            req.employeeName,
            req.suggestedName,
            mapLink,
            (req.note || '').trim() || '-',
            receiptLink,
            req.latitude + ', ' + req.longitude,
            dateCell,
            statusSpan,
            actionsCell
        ]);
        
        const labels = ["الموظف", "اسم الموقع المقترح", "رابط الخريطة", "ملاحظة الانتقالات", "مرفق", "الإحداثيات", "التاريخ", "الحالة", "الإجراءات"];
        row.querySelectorAll('td').forEach((td, i) => td.setAttribute('data-label', labels[i]));
        tbody.appendChild(row);
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

<<<<<<< HEAD
<<<<<<< HEAD
    setLoading('approveRequestModal', true);
    const token = localStorage.getItem('hrToken');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ 
                action: 'approveSiteRequest', 
                id: id, 
                name: name, 
                transportPrice: transportPrice, 
                radius: radius,
                mode: mode 
            }),
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
=======
    const matchedRequest = allSiteRequests.find(req => String(req.id) === String(id));
    const mapLink = matchedRequest ? matchedRequest.mapLink : '';

    document.getElementById('loader').classList.remove('hidden');
    try {
=======
    const matchedRequest = allSiteRequests.find(req => String(req.id) === String(id));
    const mapLink = matchedRequest ? matchedRequest.mapLink : '';

    document.getElementById('loader').classList.remove('hidden');
    try {
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        const result = await callApi({ 
            action: 'approveSiteRequest', 
            id: id, 
            name: name, 
            transportPrice: transportPrice, 
            radius: radius,
            mode: mode,
            mapLink: mapLink
<<<<<<< HEAD
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        });
        if(result.success) {
            showToast(result.message, "success");
            closeApproveModal();
            await Promise.all([fetchSiteRequests(true), fetchSites(true)]);
        } else showToast("خطأ: " + result.message, "error");
    } catch(e) { showToast("خطأ في الاتصال", "error"); }
    setLoading('approveRequestModal', false);
}

async function rejectRequest(id) {
    if(!(await showConfirm("هل أنت متأكد من رفض هذا الموقع؟"))) return;

    const token = localStorage.getItem('hrToken');
    setLoading(document.body, true);
    try {
<<<<<<< HEAD
<<<<<<< HEAD
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'rejectSiteRequest', id: id }),
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const result = await res.json();
=======
        const result = await callApi({ action: 'rejectSiteRequest', id: id });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
=======
        const result = await callApi({ action: 'rejectSiteRequest', id: id });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            showToast(result.message, "success");
            await fetchSiteRequests(true);
        } else showToast("خطأ: " + result.message, "error");
    } catch(e) { showToast("خطأ في الاتصال", "error"); }
    setLoading(document.body, false);
}

async function clearProcessedRequests() {
    if(!(await showConfirm("هل أنت متأكد من مسح جميع الطلبات المعالجة؟ لا يمكن التراجع عن هذا الإجراء."))) return;

    const token = localStorage.getItem('hrToken');
    setLoading(document.body, true);
    try {
<<<<<<< HEAD
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'clearProcessedRequests' }),
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const result = await res.json();
=======
        const result = await callApi({ action: 'clearProcessedRequests' });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            showToast(result.message, "success");
            await initDashboard(true); // Refresh all data to sync
        } else showToast("خطأ: " + result.message, "error");
    } catch(e) { showToast("خطأ في الاتصال", "error"); }
    setLoading(document.body, false);
}
async function fetchHolidays() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'getHolidays' }, 'GET');
        if(result.success) {
            allHolidays = result.data || [];
            renderHolidaysTable(allHolidays);
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderHolidaysTable(data) {
    const tbody = document.getElementById('holidaysTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    [...data].forEach(h => {
        tbody.innerHTML += `
            <tr>
                <td>${h.date}</td>
                <td>${h.name}</td>
                <td>
                    <button class="btn-danger" style="padding:5px 10px; width:auto;" onclick="deleteHoliday('${h.id}', '${h.date}')">حذف 🗑️</button>
                </td>
            </tr>
        `;
    });
}

function openHolidayModal() {
    document.getElementById('holidayDate').value = '';
    document.getElementById('holidayName').value = '';
    document.getElementById('holidayModal').classList.remove('hidden');
}

function closeHolidayModal() {
    document.getElementById('holidayModal').classList.add('hidden');
}

async function saveHoliday() {
    const date = document.getElementById('holidayDate').value;
    const name = document.getElementById('holidayName').value.trim();
    if (!date || !name) return alert("يرجى اختيار التاريخ والاسم");

    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'addHoliday', date, name });
        if(result.success) {
            closeHolidayModal();
            fetchHolidays();
        } else alert("خطأ: " + result.message);
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function deleteHoliday(id, date) {
    if(!confirm(`هل أنت متأكد من حذف العطلة الخاصة بيوم ${date}؟`)) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
<<<<<<< HEAD
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'deleteHoliday', id, date }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) fetchHolidays();
        else alert("خطأ: " + result.message);
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

// ------ EXTRA ALLOWANCE MGMT ------
function renderAllowanceRequestsTable(data) {
    const tbody = document.getElementById('allowanceRequestsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Sort by checking so newest are first
    const pending = data.filter(a => a.extraAmountStatus === 'pending');
    
    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد طلبات معلقة حالياً</td></tr>';
        return;
    }

    [...pending].reverse().forEach(req => {
        const dateObj = new Date(req.checkIn);
        const dateStr = dateObj.toLocaleString('ar-EG');
        
        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${req.employeeName}</td>
                <td data-label="الموقع المتواجد به">${req.siteName}</td>
                <td data-label="المبلغ المطلوب" style="font-weight:bold; color:var(--secondary);">${req.requestedExtraAmount} ج.م</td>
                <td data-label="السبب / الملاحظة">${req.extraAmountReason || '-'}</td>
                <td data-label="تاريخ الطلب">${dateStr}</td>
                <td data-label="الحالة"><span style="color:var(--warning)">قيد الانتظار</span></td>
                <td data-label="الإجراءات">
                    <div style="display:flex; gap:8px;">
                        <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto; background:var(--secondary);" onclick="approveExtraAllowance('${req.id}')">موافقة ✓</button>
                        <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="rejectExtraAllowance('${req.id}')">رفض ✕</button>
                    </div>
                </td>
            </tr>
        `;
    });
}

async function approveExtraAllowance(id) {
    if(!confirm("هل أنت متأكد من الموافقة على هذا المبلغ الإضافي؟")) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'approveExtraAllowance', id: id });
=======
        const result = await callApi({ action: 'clearProcessedRequests' });
>>>>>>> 807f258f64b4c67c4f03fc92c8a45fe3e7c5a20b
        if(result.success) {
            alert(result.message);
            await initDashboard(true); // Refresh data
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function rejectExtraAllowance(id) {
    if(!confirm("هل أنت متأكد من رفض هذا الطلب؟")) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'rejectExtraAllowance', id: id });
        if(result.success) {
            alert(result.message);
            await initDashboard(true); // Refresh data
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}
async function fetchHolidays() {
    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'getHolidays' }, 'GET');
        if(result.success) {
            allHolidays = result.data || [];
            renderHolidaysTable(allHolidays);
        }
    } catch(e) { console.error(e); }
    document.getElementById('loader').classList.add('hidden');
}

function renderHolidaysTable(data) {
    const tbody = document.getElementById('holidaysTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    [...data].forEach(h => {
        tbody.innerHTML += `
            <tr>
                <td>${h.date}</td>
                <td>${h.name}</td>
                <td>
                    <button class="btn-danger" style="padding:5px 10px; width:auto;" onclick="deleteHoliday('${h.id}', '${h.date}')">حذف 🗑️</button>
                </td>
            </tr>
        `;
    });
}

function openHolidayModal() {
    document.getElementById('holidayDate').value = '';
    document.getElementById('holidayName').value = '';
    document.getElementById('holidayModal').classList.remove('hidden');
}

function closeHolidayModal() {
    document.getElementById('holidayModal').classList.add('hidden');
}

async function saveHoliday() {
    const date = document.getElementById('holidayDate').value;
    const name = document.getElementById('holidayName').value.trim();
    if (!date || !name) return alert("يرجى اختيار التاريخ والاسم");

    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'addHoliday', date, name });
        if(result.success) {
            closeHolidayModal();
            fetchHolidays();
        } else alert("خطأ: " + result.message);
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function deleteHoliday(id, date) {
    if(!confirm(`هل أنت متأكد من حذف العطلة الخاصة بيوم ${date}؟`)) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'deleteHoliday', id, date }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if(result.success) fetchHolidays();
        else alert("خطأ: " + result.message);
    } catch(e) { alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

// ------ EXTRA ALLOWANCE MGMT ------
function renderAllowanceRequestsTable(data) {
    const tbody = document.getElementById('allowanceRequestsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    // Sort by checking so newest are first
    const pending = data.filter(a => a.extraAmountStatus === 'pending');
    
    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">لا توجد طلبات معلقة حالياً</td></tr>';
        return;
    }

    [...pending].reverse().forEach(req => {
        const dateObj = new Date(req.checkIn);
        const dateStr = dateObj.toLocaleString('ar-EG');
        
        tbody.innerHTML += `
            <tr>
                <td data-label="الموظف">${req.employeeName}</td>
                <td data-label="الموقع المتواجد به">${req.siteName}</td>
                <td data-label="المبلغ المطلوب" style="font-weight:bold; color:var(--secondary);">${req.requestedExtraAmount} ج.م</td>
                <td data-label="السبب / الملاحظة">${req.extraAmountReason || '-'}</td>
                <td data-label="تاريخ الطلب">${dateStr}</td>
                <td data-label="الحالة"><span style="color:var(--warning)">قيد الانتظار</span></td>
                <td data-label="الإجراءات">
                    <div style="display:flex; gap:8px;">
                        <button class="btn-primary" style="padding:5px 12px; font-size:0.85rem; width:auto; background:var(--secondary);" onclick="approveExtraAllowance('${req.id}')">موافقة ✓</button>
                        <button class="btn-danger" style="padding:5px 12px; font-size:0.85rem; width:auto;" onclick="rejectExtraAllowance('${req.id}')">رفض ✕</button>
                    </div>
                </td>
            </tr>
        `;
    });
}

async function approveExtraAllowance(id) {
    if(!confirm("هل أنت متأكد من الموافقة على هذا المبلغ الإضافي؟")) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'approveExtraAllowance', id: id });
        if(result.success) {
            alert(result.message);
            await initDashboard(true); // Refresh data
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}

async function rejectExtraAllowance(id) {
    if(!confirm("هل أنت متأكد من رفض هذا الطلب؟")) return;
    document.getElementById('loader').classList.remove('hidden');
    try {
        const result = await callApi({ action: 'rejectExtraAllowance', id: id });
        if(result.success) {
            alert(result.message);
            await initDashboard(true); // Refresh data
        } else alert("خطأ: " + result.message);
    } catch(e) { console.error(e); alert("خطأ في الاتصال"); }
    document.getElementById('loader').classList.add('hidden');
}
