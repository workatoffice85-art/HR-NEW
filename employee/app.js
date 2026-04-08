const API_URL =
    (window.APP_CONFIG && window.APP_CONFIG.API_URL) ||
    'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let currentUser = JSON.parse(localStorage.getItem('empSession'));
let currentSite = null;
let lastLocation = null;
let lastDetection = null;
let sitesData = [];
let faceMatcher = null;
let currentFaceDescriptor = null;
let timerInterval = null; // Added for live counter // Stored during video match
let tempEmail = ""; // used during registration
let tempPhone = ""; // used during registration
const MODEL_URL = '../models';

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

function showSection(id) {
    document.querySelectorAll('.glass-card').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
}

function checkSession() {
    const userJson = localStorage.getItem('empSession');
    if (userJson) {
        currentUser = JSON.parse(userJson);
        showSection('dashboardSection');
        document.getElementById('welcomeText').innerText = `مرحباً ${currentUser.name}`;
        initSystem();
    } else {
        showSection('loginSection');
    }
}

// 1. Normal Login
async function login() {
    const email = document.getElementById('loginIdentifier').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    if (!email || !pass) return alert("أدخل بيانات الدخول");

    document.querySelector('#loginSection button').innerText = 'جاري التحقق...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'login', identifier: email, password: pass }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await response.json();
        
        if (result.success) {
            localStorage.setItem('empSession', JSON.stringify(result.data));
            checkSession();
        } else {
            showError('loginError', result.message || 'البريد أو كلمة المرور غير صحيحة');
        }
    } catch (e) {
        showError('loginError', 'فشل الاتصال بالخادم: ' + e.message);
        console.error(e);
    }
    document.querySelector('#loginSection button').innerText = 'دخول';
}

// 2. Request OTP (Registration)
async function requestOTP() {
    tempEmail = document.getElementById('regEmail').value.trim();
    tempPhone = document.getElementById('regPhone').value.trim();
    if(!tempPhone) return alert("أدخل رقم الهاتف");
    if(!tempEmail) return alert("أدخل الإيميل");

    document.getElementById('btnRequestOTP').innerText = 'جاري الإرسال...';
    try {
       const res = await fetch(API_URL, {
            method:'POST', body: JSON.stringify({action:'sendOTP', email: tempEmail, phone: tempPhone}), headers:{'Content-Type':'text/plain'}
       });
       const result = await res.json();
       if(result.success) {
           showSection('verifyOTPSection');
       } else {
           showError('otpError', result.message);
       }
    } catch(e) {
        showError('otpError', 'خطأ في الشبكة: ' + e.message);
        console.error(e);
    }
    document.getElementById('btnRequestOTP').innerText = 'إرسال كود التحقق';
}

// 3. Verify OTP
async function verifyOTP() {
    const code = document.getElementById('otpCode').value.trim();
    if(!code) return alert("أدخل الرمز");
    
    document.getElementById('btnVerifyOTP').innerText = 'جاري...';
    try {
       const res = await fetch(API_URL, {
            method:'POST', body: JSON.stringify({action:'verifyOTP', email: tempEmail, code: code}), headers:{'Content-Type':'text/plain'}
       });
       const result = await res.json();
       if(result.success) {
           showSection('registrationSection');
           startRegistrationVideo(); // start face registration
       } else {
           showError('verifyError', result.message);
       }
    } catch(e) {
        showError('verifyError', 'خطأ في الشبكة: ' + e.message);
        console.error(e);
    }
    document.getElementById('btnVerifyOTP').innerText = 'تأكيد الرمز';
}

// 4. Face Registration Capture
async function startRegistrationVideo() {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    
    const video = document.getElementById('regVideo');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        .then(stream => { video.srcObject = stream; })
        .catch(err => alert("لا يمكن الوصول للكاميرا"));
}

async function captureFaceRegistration() {
    const video = document.getElementById('regVideo');
    document.getElementById('regStatusMessage').classList.remove('hidden');
    document.getElementById('regStatusMessage').innerText = 'جاري مسح الوجه...';
    
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    const detections = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
    if(detections) {
        registeredFaceDescriptor = Array.from(detections.descriptor);
        document.getElementById('regStatusMessage').innerText = 'تم التقاط البصمة بنجاح ✓';
        document.getElementById('regStatusMessage').className = 'success-text';
    } else {
        document.getElementById('regStatusMessage').innerText = 'لم يتم التعرف على وجه للأسف، دقق في الإضاءة.';
        document.getElementById('regStatusMessage').className = 'error-text';
    }
}

// 5. Complete Registration
async function completeRegistration() {
    const name = document.getElementById('regName').value.trim();
    const pass = document.getElementById('regPass').value.trim();
    if(!name || !pass || !registeredFaceDescriptor) {
        return showError('regError', 'أكمل بياناتك والتقط البصمة');
    }

    document.getElementById('btnCompleteReg').innerText = 'جاري الإنشاء...';
    
    // Generate Random Employee ID internally
    const newId = 'EMP' + Math.floor(1000 + Math.random() * 9000);
    
    const payload = {
        action: 'saveEmployee',
        id: newId, name: name, email: tempEmail, password: pass, phone: tempPhone, role: 'employee', assignedSites: '',
        faceDescriptor: JSON.stringify(registeredFaceDescriptor)
    };

    try {
        const res = await fetch(API_URL, {
            method:'POST', body: JSON.stringify(payload), headers:{'Content-Type':'text/plain'}
        });
        const result = await res.json();
        if(result.success) {
            alert('تم إنشاء الحساب بنجاح، سجل دخول الآن');
            location.reload();
        } else {
            showError('regError', result.message);
            document.getElementById('btnCompleteReg').innerText = 'إنشاء الحساب';
        }
    } catch(e) {
        showError('regError', 'حدث خطأ: ' + e.message);
        console.error(e);
        document.getElementById('btnCompleteReg').innerText = 'إنشاء الحساب';
    }
}

function showError(elId, msg) {
    const el = document.getElementById(elId);
    el.innerText = msg;
    el.classList.remove('hidden');
}

// -------- DASHBOARD SYSTEM --------------
function logout() {
    localStorage.removeItem('empSession');
    location.reload();
}

async function initSystem() {
    setStatus('🔄 جاري بدء النظام (النسخة المحدثة)...', 'text-muted');
    
    // Step 1: Load Sites
    try {
        const response = await fetch(`${API_URL}?action=getSites&employeeId=${encodeURIComponent(currentUser.id)}`);
        const result = await response.json();
        if (result.success) {
            sitesData = result.data;
            setStatus(`📡 تم تحميل ${sitesData.length} موقع. جاري تحميل الذكاء الاصطناعي...`, 'text-muted');
        } else {
            setStatus('⚠️ فشل في تحميل المواقع من السيرفر', 'error-text');
        }
    } catch(e) {
        setStatus('❌ خطأ في الاتصال بالسيرفر', 'error-text');
    }

    // Step 2: Load Face Models
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    } catch(e) {
        setStatus('❌ مشكلة في تحميل ملفات الذكاء الاصطناعي من السيرفر', 'error-text');
        return;
    }

    // Step 3: Setup Face Matcher
    if (currentUser.faceDescriptor) {
        try {
            const descArray = new Float32Array(JSON.parse(currentUser.faceDescriptor));
            const labeledDescriptor = new faceapi.LabeledFaceDescriptors(currentUser.name, [descArray]);
            faceMatcher = new faceapi.FaceMatcher([labeledDescriptor], 0.6);
            setStatus('✅ النظام جاهز. وجّه الكاميرا إليك...', 'success-text');
        } catch(e) {
            setStatus('⚠️ خطأ في قراءة بصمة الوجه المسجلة', 'error-text');
        }
    } else {
        setStatus('⚠️ لم يتم تسجيل بصمة وجه. وجّه الكاميرا إليك...', 'text-muted');
    }

    startVideo();
    getLocation();
    checkCurrentStatus(); // Initial status check after login
}

async function checkCurrentStatus() {
    try {
        const res = await fetch(`${API_URL}?action=getAttendance&employeeId=${currentUser.id}`);
        const result = await res.json();
        if (result.success && result.data.length > 0) {
            const lastRecord = result.data[result.data.length - 1];
            const isCheckedIn = (lastRecord.checkIn && !lastRecord.checkOut);
            
            // Check if check-in was today (to avoid keeping old open sessions from yesterday)
            const checkInDate = new Date(lastRecord.checkIn).toDateString();
            const today = new Date().toDateString();

            if (isCheckedIn && checkInDate === today) {
                setAppState('in', lastRecord.checkIn);
            } else {
                setAppState('out');
            }
        } else {
            setAppState('out');
        }
    } catch(e) {
        console.error("Status check failed", e);
        setAppState('out'); // Fallback to check-in
    }
}

function setAppState(state, startTime) {
    const btnIn = document.getElementById('btnCheckIn');
    const btnOut = document.getElementById('btnCheckOut');
    const timerContainer = document.getElementById('timerContainer');

    if (state === 'in') {
        btnIn.classList.add('hidden');
        btnOut.classList.remove('hidden');
        timerContainer.classList.remove('hidden');
        startWorkTimer(startTime);
    } else {
        btnIn.classList.remove('hidden');
        btnOut.classList.add('hidden');
        timerContainer.classList.add('hidden');
        stopWorkTimer();
    }
}

function startWorkTimer(startTime) {
    if (timerInterval) clearInterval(timerInterval);
    const start = new Date(startTime).getTime();
    
    function update() {
        const now = new Date().getTime();
        const diff = now - start;
        if (diff < 0) return;

        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);

        document.getElementById('workTimer').innerText = 
            `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    update();
    timerInterval = setInterval(update, 1000);
}

function stopWorkTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    document.getElementById('workTimer').innerText = "00:00:00";
}

function setStatus(msg, className) {
    const el = document.getElementById('statusMessage');
    if(el) { el.innerText = msg; el.className = className; }
}

function startVideo() {
    const video = document.getElementById('videoElement');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        .then(stream => { video.srcObject = stream; })
        .catch(err => setStatus('لم نتمكن من الوصول للكاميرا', 'error-text'));
    
    video.addEventListener('play', () => {
        const canvas = document.getElementById('overlay');
        const displaySize = { width: video.clientWidth, height: video.clientHeight };
        faceapi.matchDimensions(canvas, displaySize);
        
        setInterval(async () => {
            if(!faceMatcher) return;
            const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
            const detections = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
            
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (detections) {
                const resizeDetections = faceapi.resizeResults(detections, displaySize);
                faceapi.draw.drawDetections(canvas, resizeDetections);
                
                const bestMatch = faceMatcher.findBestMatch(detections.descriptor);
                if (bestMatch.label !== 'unknown' && lastLocation) {
                    setStatus('تم التحقق من الوجه بنجاح ✓', 'success-text');
                    currentFaceDescriptor = Array.from(detections.descriptor);
                    document.getElementById('btnCheckIn').disabled = false;
                    document.getElementById('btnCheckOut').disabled = false;
                } else if(bestMatch.label === 'unknown') {
                    setStatus('الوجه غير متطابق', 'error-text');
                    currentFaceDescriptor = null;
                    document.getElementById('btnCheckIn').disabled = true;
                    document.getElementById('btnCheckOut').disabled = true;
                }
            } else {
                setStatus('وجه الكاميرا إاليك', 'text-muted');
                currentFaceDescriptor = null;
                document.getElementById('btnCheckIn').disabled = true;
                document.getElementById('btnCheckOut').disabled = true;
            }
        }, 1000);
    });
}

function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            (position) => {
                lastLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                verifyLocation();
            },
            (error) => { setStatus('يرجى تفعيل الـ GPS', 'error-text'); },
            { enableHighAccuracy: true }
        );
    }
}

function verifyLocation() {
    if (!lastLocation || sitesData.length === 0) return;
    
    let detectedSite = null;
    let minDistance = Infinity;
    let closestSiteName = "";

    // Check ALL sites
    for (const site of sitesData) {
        const dist = getDistanceFromLatLonInM(lastLocation.lat, lastLocation.lng, site.latitude, site.longitude);
        if (dist < minDistance) {
            minDistance = dist;
            closestSiteName = site.name;
        }
        
        if (dist <= site.radius) {
            detectedSite = site;
            break;
        }
    }

    if (detectedSite) {
        document.getElementById('siteText').innerText = `✅ أنت في موقع: ${detectedSite.name}`;
        document.getElementById('btnRequestSite').classList.add('hidden');
        if(currentFaceDescriptor) {
            document.getElementById('btnCheckIn').disabled = false;
            document.getElementById('btnCheckOut').disabled = false;
        }
    } else {
        const distText = minDistance === Infinity ? "" : `(أقرب موقع لك هو ${closestSiteName} ويبعد ${(minDistance/1000).toFixed(2)} كم)`;
        document.getElementById('siteText').innerText = `❌ أنت خارج النطاق. ${distText}`;
        document.getElementById('btnRequestSite').classList.remove('hidden');
        document.getElementById('btnCheckIn').disabled = true;
        document.getElementById('btnCheckOut').disabled = true;
    }
}

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = deg2rad(lat2-lat1);  const dLon = deg2rad(lon2-lon1); 
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c * 1000;
}
function deg2rad(deg) { return deg * (Math.PI/180) }

async function handleCheckIn() {
    if(!currentFaceDescriptor) return alert('بصمة الوجه غير ملتقطة الحين');
    if(!lastLocation) return alert('يجب تفعيل الـ GPS');

    document.getElementById('loader').classList.remove('hidden');
    const payload = {
        action: 'addAttendance', employeeId: currentUser.id, employeeName: currentUser.name,
        checkIn: new Date().toISOString(), latitude: lastLocation.lat, longitude: lastLocation.lng,
        faceDescriptor: JSON.stringify(currentFaceDescriptor)
    };

    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            setAppState('in', payload.checkIn);
        } else alert('خطأ: ' + result.message);
    } catch(e) { console.error(e); alert('حدث خطأ في الاتصال'); }
    document.getElementById('loader').classList.add('hidden');
}

async function handleCheckOut() {
    if(!currentFaceDescriptor) return alert('بصمة الوجه غير ملتقطة الحين');
    if(!lastLocation) return alert('يجب تفعيل الـ GPS');

    document.getElementById('loader').classList.remove('hidden');
    const payload = { 
        action: 'checkoutAttendance', employeeId: currentUser.id, 
        checkOut: new Date().toISOString(), latitude: lastLocation.lat, longitude: lastLocation.lng,
        faceDescriptor: JSON.stringify(currentFaceDescriptor)
    };
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            setAppState('out');
        }
        else alert('خطأ: ' + result.message);
    } catch(e) { console.error(e); alert('حدث خطأ في الشبكة: ' + e.message); }
    document.getElementById('loader').classList.add('hidden');
}

// ------ SITE REQUEST LOGIC ------ //
function openRequestModal() {
    document.getElementById('requestSiteModal').classList.remove('hidden');
    document.getElementById('requestSiteCard').classList.remove('hidden'); // Ensure inner card is visible
    document.getElementById('suggestedSiteName').value = '';
    document.getElementById('suggestedSiteLink').value = '';
    document.getElementById('suggestedSiteNote').value = '';
}

function closeRequestModal() {
    document.getElementById('requestSiteModal').classList.add('hidden');
}

async function submitSiteRequest() {
    const name = document.getElementById('suggestedSiteName').value.trim();
    const link = document.getElementById('suggestedSiteLink').value.trim();
    const note = document.getElementById('suggestedSiteNote').value.trim();
    if (!name) return alert("يرجى إدخال اسم الموقع");
    if (!lastLocation) return alert("يجب توفير إحداثيات الموقع");

    document.getElementById('loader').classList.remove('hidden');
    
    // Validate that the link matches the current location (within 700m)
    if (link) {
        try {
            const res = await fetch(API_URL, {
                method: 'POST', body: JSON.stringify({ action: 'resolveMapLink', link: link }), headers:{'Content-Type':'text/plain'}
            });
            const result = await res.json();
            if (result.success && result.lat && result.lng) {
                const dist = getDistanceFromLatLonInM(lastLocation.lat, lastLocation.lng, parseFloat(result.lat), parseFloat(result.lng));
                if (dist > 700) {
                    document.getElementById('loader').classList.add('hidden');
                    return alert(`❌ خطأ: الرابط يشير لمكان يبعد عنك ${(dist/1000).toFixed(2)} كم. يجب أن يكون الرابط لمكانك الحالي (بحد أقصى 700 متر).`);
                }
            }
        } catch(e) { console.warn("Failed to validate link distance", e); }
    }

    const payload = {
        action: 'addSiteRequest',
        employeeId: currentUser.id,
        employeeName: currentUser.name,
        latitude: lastLocation.lat,
        longitude: lastLocation.lng,
        suggestedName: name,
        mapLink: link,
        note: note
    };
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            closeRequestModal();
        } else {
            alert("خطأ: " + result.message);
        }
    } catch (e) {
        console.error(e);
        alert("فشل الاتصال بالسيرفر");
    }
    document.getElementById('loader').classList.add('hidden');
}

// ------ MY REPORTS SYSTEM ------ //
function showMyReports() {
    showSection('myReportsSection');
    const now = new Date();
    document.getElementById('empReportMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    fetchMyReports();
}

async function fetchMyReports() {
    const monthVal = document.getElementById('empReportMonth').value;
    if(!monthVal) return;
    
    document.getElementById('loader').classList.remove('hidden');
    try {
        // Fetch only this employee's attendance using GET param
        const res = await fetch(`${API_URL}?action=getAttendance&employeeId=${currentUser.id}`);
        const result = await res.json();
        if(result.success) {
            renderMyReports(result.data, monthVal);
        }
    } catch(e) { console.error('خطأ في جلب التقارير', e); }
    document.getElementById('loader').classList.add('hidden');
}

function getWorkingDaysPassed(year, month) {
    let days = 0;
    const today = new Date();
    const endDay = (year === today.getFullYear() && month === today.getMonth()) ? today.getDate() : new Date(year, month + 1, 0).getDate();
    
    for (let i = 1; i <= endDay; i++) {
        const d = new Date(year, month, i);
        // Exclude Friday (5) and Saturday (6)
        if (d.getDay() !== 5 && d.getDay() !== 6) {
            days++;
        }
    }
    return days;
}

function toTransportNumber(value) {
    const parsed = parseFloat(value || 0);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function renderMyReports(data, monthStr) {
    const targetYear = parseInt(monthStr.split('-')[0]);
    const targetMonth = parseInt(monthStr.split('-')[1]) - 1;
    const now = new Date();

    // 1. Get all present days in this month
    const presentRecords = data.filter(record => {
        const d = new Date(record.checkIn);
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
    });

    // 2. Identify working days that passed (Sun-Thu)
    const workingDaysPassed = [];
    const endDay = (targetYear === now.getFullYear() && targetMonth === now.getMonth()) 
                   ? now.getDate() 
                   : new Date(targetYear, targetMonth + 1, 0).getDate();

    for (let i = 1; i <= endDay; i++) {
        const d = new Date(targetYear, targetMonth, i);
        // Weekend in Egypt: Friday (5) and Saturday (6)
        if (d.getDay() !== 5 && d.getDay() !== 6) {
            workingDaysPassed.push(new Date(targetYear, targetMonth, i).toDateString());
        }
    }

    let totalHours = 0;
    let totalTransport = 0;
    const dailyTransport = {};
    
    const tbody = document.getElementById('myReportsTableBody');
    tbody.innerHTML = '';

    // Create a set of dates where user was present for quick lookup
    const presentDates = new Set(presentRecords.map(r => new Date(r.checkIn).toDateString()));
    const lateDates = new Set(presentRecords.filter(r => r.status === 'late').map(r => new Date(r.checkIn).toDateString()));

    let totalLates = lateDates.size; // Only count one late per unique date
    const fullReport = [];

    // Add Present Records
    presentRecords.forEach(record => {
        const recordDateObj = new Date(record.checkIn);
        const dateKey = !Number.isNaN(recordDateObj.getTime()) ? recordDateObj.toDateString() : null;

        if(record.totalHours) totalHours += parseFloat(record.totalHours);
        if (dateKey) {
            const transportValue = toTransportNumber(record.transportPrice);
            if (!(dateKey in dailyTransport)) {
                dailyTransport[dateKey] = transportValue;
            } else if (transportValue > dailyTransport[dateKey]) {
                dailyTransport[dateKey] = transportValue;
            }
        }
        fullReport.push({
            date: new Date(record.checkIn),
            checkIn: record.checkIn,
            checkOut: record.checkOut,
            status: record.status, // 'present' or 'late'
            transport: record.transportPrice || 0,
            type: 'entry'
        });
    });

    totalTransport = Object.values(dailyTransport).reduce((sum, value) => sum + value, 0);

    // Add Absent Days (Only for working days that have no record)
    workingDaysPassed.forEach(dateStr => {
        if (!presentDates.has(dateStr)) {
            fullReport.push({
                date: new Date(dateStr),
                type: 'absent'
            });
        }
    });

    // Sort by date descending
    fullReport.sort((a, b) => b.date - a.date);

    // 4. Render to Table
    fullReport.forEach(item => {
        if (item.type === 'entry') {
            let statusText = 'حاضر';
            let statusColor = 'var(--secondary)';
            
            if (item.status === 'late') {
                statusText = 'متأخر';
                statusColor = 'var(--danger)';
            } else if (item.status === 'overtime') {
                statusText = 'عمل إضافي';
                statusColor = '#3b82f6'; // Bright Blue
            }

            tbody.innerHTML += `
                <tr>
                    <td data-label="التاريخ">${item.date.toLocaleDateString('ar-EG')}</td>
                    <td data-label="الحضور" dir="ltr">${new Date(item.checkIn).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}</td>
                    <td data-label="الانصراف" dir="ltr">${item.checkOut ? new Date(item.checkOut).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}) : '-'}</td>
                    <td data-label="البدل">${item.transport} ج.م</td>
                    <td data-label="الحالة"><span style="color:${statusColor}">${statusText}</span></td>
                </tr>
            `;
        } else {
            // Absent Row
            tbody.innerHTML += `
                <tr style="background: rgba(239, 68, 68, 0.05);">
                    <td data-label="التاريخ">${item.date.toLocaleDateString('ar-EG')}</td>
                    <td data-label="التفاصيل" colspan="3" style="text-align:center !important; color:var(--danger); font-size:0.8rem;">غائب (لم يتم تسجيل حضور)</td>
                    <td data-label="الحالة"><span style="color:var(--danger)">غائب</span></td>
                </tr>
            `;
        }
    });

    const totalAbsent = workingDaysPassed.length - presentDates.size;

    document.getElementById('empTotalPresent').innerText = presentDates.size; // Use size of unique dates set
    document.getElementById('empTotalAbsent').innerText = totalAbsent > 0 ? totalAbsent : 0;
    document.getElementById('empTotalLates').innerText = totalLates;
    document.getElementById('empTotalHours').innerText = totalHours.toFixed(2);
    document.getElementById('empTotalTransport').innerText = totalTransport.toFixed(2) + " ج.م";
}

