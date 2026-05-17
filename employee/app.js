const API_URL = '/api/exec';
// const OLD_BACKUP_API = 'https://script.google.com/macros/s/AKfycbwNhaRKDP-7M4dXSQend8RbYPkXRgs5nzN0-BmNzxEO8IkBN9lt6KDtJCdOqpovhJEY1Q/exec';
let currentUser = JSON.parse(localStorage.getItem('empSession'));
let currentSite = null;
let lastLocation = null;
let lastDetection = null;
let sitesData = [];
let allAttendanceData = [];
let allLeaveRequests = [];
let faceMatcher = null;
let currentFaceDescriptor = null; // DEPRECATED: use currentBiometricVerification
let currentBiometricVerification = null; // { type: 'face'|'fingerprint', data: any }
let timerInterval = null;
let isFaceVerified = false; // DEPRECATED: use isBiometricVerified
let isBiometricVerified = false; // Unified biometric verification status
let lastDetectedSite = null;
let isDetecting = false;
let isCheckInProgress = false; // Prevent duplicate check-in clicks
let faceDetectionInterval = null;
let consecutiveSuccessFrames = 0;
let geolocationWatchId = null;
let tempEmail = ""; // used during registration
let tempPhone = ""; // used during registration
let userBiometricType = null; // selected biometric type during registration
let registeredBiometricData = null; // captured biometric data during registration
let registeredFaceDescriptor = null; // DEPRECATED: for backward compatibility
let allOfficialHolidays = [];
let appSettings = {}; // Store system settings including weekend days
const MODEL_URL = '../models';

// Helper: Extract Cairo time from ISO string (format: 2026-04-26T09:34:48+02:00)
// Returns time in format "9:34:48 ص" without any timezone conversion
function formatCairoTime(isoString) {
    if (!isoString) return '-';
    const match = isoString.match(/T(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return isoString;
    
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const seconds = match[3];
    
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
    
    const year = match[1];
    const month = match[2];
    const day = match[3];
    
    return `${day}/${parseInt(month, 10)}/${year}`;
}

// Audio feedback functions
function playSuccessSound() {
    try {
        // Create audio context if not exists
        if (!window.audioContext) {
            window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Create oscillator for success sound (pleasant chime)
        const oscillator = window.audioContext.createOscillator();
        const gainNode = window.audioContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.value = 800; // Hz
        gainNode.gain.value = 0.2; // Volume
        
        oscillator.connect(gainNode);
        gainNode.connect(window.audioContext.destination);
        
        oscillator.start();
        oscillator.stop(window.audioContext.currentTime + 0.2); // 200ms duration
    } catch (e) {
        console.warn('Audio playback failed:', e);
        // Fallback to alert if audio fails
        // alert('نجح التسجيل');
    }
}

function playErrorSound() {
    try {
        // Create audio context if not exists
        if (!window.audioContext) {
            window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Create oscillator for error sound (low beep)
        const oscillator = window.audioContext.createOscillator();
        const gainNode = window.audioContext.createGain();
        
        oscillator.type = 'sine';
        oscillator.frequency.value = 200; // Hz
        gainNode.gain.value = 0.3; // Volume
        
        oscillator.connect(gainNode);
        gainNode.connect(window.audioContext.destination);
        
        oscillator.start();
        oscillator.stop(window.audioContext.currentTime + 0.3); // 300ms duration
    } catch (e) {
        console.warn('Audio playback failed:', e);
        // Fallback to alert if audio fails
        // alert('حدث خطأ');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

function showSection(id) {
    const sections = ['loginSection', 'otpSection', 'verifyOTPSection', 'registrationSection', 'dashboardSection', 'myReportsSection'];
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
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
           initBiometricRegistration(); // Initialize biometric selection and registration
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

// Biometric Registration Functions - FACE MODEL ONLY
async function initBiometricRegistration() {
    // ALWAYS use camera-based face recognition for registration
    // Skip hardware biometric detection entirely
    
    // Check if camera is available
    const hasCamera = await checkCameraAvailability();
    
    if (!hasCamera) {
        showError('regError', '⚠️ يجب السماح بالوصول للكاميرا لتسجيل بصمة الوجه');
        return;
    }
    
    // Force face model (camera-based) registration
    userBiometricType = 'face';
    
    // Hide selection and hardware sections
    document.getElementById('biometricSelection').classList.add('hidden');
    document.getElementById('fingerprintRegistrationSection').classList.add('hidden');
    
    // Show face registration section only
    document.getElementById('faceRegistrationSection').classList.remove('hidden');
    
    // Start the camera for face registration
    startRegistrationVideo();
    
    console.log('Face model registration initialized');
}

// Helper: Check camera availability
async function checkCameraAvailability() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return false;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch (e) {
        console.log('Camera not available:', e.message);
        return false;
    }
}

function selectBiometricType(type) {
    userBiometricType = type;
    
    // Hide selection and show appropriate section
    document.getElementById('biometricSelection').classList.add('hidden');
    document.getElementById('faceRegistrationSection').classList.add('hidden');
    document.getElementById('fingerprintRegistrationSection').classList.add('hidden');
    
    if (type === 'face') {
        // Camera-based face recognition
        document.getElementById('faceRegistrationSection').classList.remove('hidden');
        startRegistrationVideo();
    } else if (type === 'fingerprint' || type === 'face_hardware') {
        // Hardware biometric (fingerprint or Face ID) - both use same WebAuthn flow
        document.getElementById('fingerprintRegistrationSection').classList.remove('hidden');
        
        // Update UI based on type
        const isFaceId = type === 'face_hardware';
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        const label = isFaceId ? (isIOS ? 'Face ID' : 'Face Unlock') : 'بصمة الإصبع';
        const icon = isFaceId ? '📱' : '👆';
        const desc = isFaceId ? 'استخدم بصمة وجهك للتسجيل' : 'اضغط الزر أدناه لتسجيل بصمة إصبعك';
        const btnText = isFaceId ? 'تسجيل Face ID' : 'تسجيل بصمة الإصبع';
        
        // Update all UI elements
        document.getElementById('hardwareBioLabel').innerHTML = `${label} <small>(هام جداً للحضور)</small>`;
        document.getElementById('hardwareBioIcon').innerText = icon;
        document.getElementById('hardwareBioDesc').innerText = desc;
        document.getElementById('hardwareBioBtn').innerText = btnText;
    }
}

async function captureFaceRegistration() {
    const video = document.getElementById('regVideo');
    document.getElementById('regStatusMessage').classList.remove('hidden');
    document.getElementById('regStatusMessage').innerText = 'جاري مسح الوجه...';
    
    try {
        const result = await biometricManager.enroll('face', { videoElement: video, modelUrl: MODEL_URL });
        registeredBiometricData = result;
        registeredFaceDescriptor = result.data; // For backward compatibility
        
        document.getElementById('regStatusMessage').innerText = 'تم التقاط بصمة الوجه بنجاح ✓';
        document.getElementById('regStatusMessage').className = 'success-text';
        playSuccessSound();
        vibrateSuccess();
    } catch (e) {
        document.getElementById('regStatusMessage').innerText = e.message || 'لم يتم التعرف على وجه للأسف، دقق في الإضاءة.';
        document.getElementById('regStatusMessage').className = 'error-text';
        playErrorSound();
        vibrateError();
    }
}

async function captureFingerprintRegistration() {
    const statusEl = document.getElementById('fingerprintRegStatusMessage');
    const bioType = userBiometricType || 'fingerprint'; // 'fingerprint' or 'face_hardware'
    const isFaceId = bioType === 'face_hardware';
    
    statusEl.classList.remove('hidden');
    statusEl.innerText = isFaceId ? 'استخدم Face ID للتسجيل...' : 'ضع إصبعك على الماسح...';
    statusEl.className = '';
    
    try {
        const name = document.getElementById('regName').value.trim() || 'User';
        const result = await biometricManager.enroll(bioType, { 
            userId: 'TEMP_' + Date.now(), 
            userName: name 
        });
        registeredBiometricData = result;
        
        const successMsg = isFaceId ? 'تم تسجيل Face ID بنجاح ✓' : 'تم تسجيل بصمة الإصبع بنجاح ✓';
        statusEl.innerText = successMsg;
        statusEl.className = 'success-text';
        playSuccessSound();
        vibrateSuccess();
    } catch (e) {
        const errorMsg = isFaceId ? 'فشل في تسجيل Face ID' : 'فشل في تسجيل بصمة الإصبع';
        statusEl.innerText = e.message || errorMsg;
        statusEl.className = 'error-text';
        playErrorSound();
        vibrateError();
    }
}

// 5. Complete Registration
async function completeRegistration() {
    const name = document.getElementById('regName').value.trim();
    const pass = document.getElementById('regPass').value.trim();
    if(!name || !pass || !registeredBiometricData) {
        return showError('regError', 'أكمل بياناتك وسجل بصمة واحدة (وجه أو إصبع)');
    }

    document.getElementById('btnCompleteReg').innerText = 'جاري الإنشاء...';
    
    // Generate Random Employee ID internally
    const newId = 'EMP' + Math.floor(1000 + Math.random() * 9000);
    
    const payload = {
        action: 'saveEmployee',
        id: newId, name: name, email: tempEmail, password: pass, phone: tempPhone, role: 'employee', assignedSites: '',
        biometricType: registeredBiometricData.type,
        biometricData: JSON.stringify(registeredBiometricData), // Store full object with type and data
        // Legacy field for backward compatibility (camera face only)
        faceDescriptor: registeredBiometricData.type === 'face' ? registeredBiometricData.data : null
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

    // Step 1: Load Data & AI Models in Parallel
    try {
        const dataPromise = fetch(`${API_URL}?action=getPortalInitialData&employeeId=${encodeURIComponent(currentUser.id)}`).then(r => r.json());
        const holidaysPromise = fetch(`${API_URL}?action=getOfficialHolidays`).then(r => r.json());
        const settingsPromise = fetch(`${API_URL}?action=getSettings`).then(r => r.json());
        const modelPromise = Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);

        const [dataResult, holidaysResult, _] = await Promise.all([dataPromise, holidaysPromise, modelPromise]);

        if (dataResult.success) {
            sitesData = dataResult.sites || [];
            allAttendanceData = dataResult.attendance || [];
            allLeaveRequests = dataResult.leaveRequests || [];

            // Load official holidays
            if (holidaysResult.success) {
                allOfficialHolidays = holidaysResult.data || [];
            }

            // Load settings (weekend days, etc.)
            try {
                const settingsResult = await settingsPromise;
                console.log('Settings loaded:', settingsResult);
                if (settingsResult.success) {
                    appSettings = settingsResult.data || {};
                    console.log('appSettings set to:', appSettings);
                } else {
                    console.error('Settings load failed:', settingsResult);
                }
            } catch (e) {
                console.error('Settings fetch error:', e);
            }

            // Process initial status
            processAttendanceStatus(allAttendanceData);

            // Initialize notifications
            initNotifications();

            setStatus(`📡 تم تحميل ${sitesData.length} موقع. النظام جاهز...`, 'text-muted');
        } else {
            console.error("Data load failed", dataResult);
            setStatus('⚠️ فشل في تحميل البيانات من السيرفر', 'error-text');
        }
    } catch(e) {
        console.error("Initial load error", e);
        setStatus('❌ خطأ في الاتصال أو تحميل ملفات الذكاء الاصطناعي', 'error-text');
        return;
    }

    // Step 3: Setup Biometric System
    await initBiometricSystem();

    // Step 4: Start video only for camera-based face recognition users
    // For hardware biometric users (fingerprint/face_id), hide camera and don't start video
    const userBioType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : null);
    if (userBioType === 'face') {
        startVideo();
    } else {
        // Hide camera container for hardware biometric users
        const cameraContainer = document.querySelector('.camera-container');
        if (cameraContainer) cameraContainer.classList.add('hidden');
    }
    getLocation();
}

function processAttendanceStatus(data) {
    if (data && data.length > 0) {
        const lastRecord = data[data.length - 1];
        const isCheckedIn = (lastRecord.checkIn && !lastRecord.checkOut);
        if (isCheckedIn) {
            setAppState('in', lastRecord.checkIn);
        } else {
            setAppState('out');
        }
    } else {
        setAppState('out');
    }
}

// Initialize biometric system based on user registered biometric type
async function initBiometricSystem() {
    // Determine user's biometric type
    const userBioType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : null);
    
    if (!userBioType) {
        setStatus('⚠️ لم يتم تسجيل بصمة. يرجى التواصل مع HR', 'error-text');
        document.getElementById('bioTypeBadge').innerText = 'غير مسجل';
        return;
    }
    
    // Show biometric type badge
    const bioNames = {
        'face': '📷 كاميرا',
        'fingerprint': '👆 بصمة إصبع',
        'face_hardware': '📱 Face ID'
    };
    document.getElementById('bioTypeBadge').innerText = bioNames[userBioType] || '📷 كاميرا';
    
    // Setup based on registered biometric type
    if (userBioType === 'face') {
        await initFaceVerification();
    } else {
        // Hardware biometric (fingerprint or Face ID)
        await initHardwareBiometricVerification(userBioType);
    }
}

async function initFaceVerification() {
    try {
        const biometricData = currentUser.biometricData || currentUser.faceDescriptor;
        console.log('🔐 initFaceVerification - biometricData exists:', !!biometricData);

        if (!biometricData) {
            setStatus('⚠️ لم يتم تسجيل بصمة وجه', 'error-text');
            return;
        }

        let parsedData = JSON.parse(biometricData);
        console.log('🔐 Parsed biometric data type:', typeof parsedData, 'isArray:', Array.isArray(parsedData));

        // Handle new format: { type: 'face', data: [...] }
        if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
            if (parsedData.type === 'face' && parsedData.data) {
                console.log('🔐 Detected new format biometric data, extracting descriptor...');
                // Data might be double-encoded string or already parsed
                let descriptorData = parsedData.data;
                if (typeof descriptorData === 'string') {
                    descriptorData = JSON.parse(descriptorData);
                }
                parsedData = descriptorData;
            }
        }

        const descArray = new Float32Array(parsedData);
        console.log('🔐 Descriptor array length:', descArray.length);

        const labeledDescriptor = new faceapi.LabeledFaceDescriptors(currentUser.name, [descArray]);
        faceMatcher = new faceapi.FaceMatcher([labeledDescriptor], 0.6);

        console.log('🔐 Face matcher initialized successfully');
        setStatus('✅ النظام جاهز. وجّه الكاميرا إليك...', 'success-text');
    } catch(e) {
        console.error('🔐 Face verification init error:', e);
        setStatus('⚠️ خطأ في قراءة بصمة الوجه المسجلة', 'error-text');
    }
}

async function initHardwareBiometricVerification(bioType) {
    try {
        const biometricData = currentUser.biometricData || currentUser.faceDescriptor;
        if (!biometricData) {
            const typeName = bioType === 'face_hardware' ? 'Face ID' : 'بصمة الإصبع';
            setStatus(`⚠️ لم يتم تسجيل ${typeName}`, 'error-text');
            return;
        }
        
        // For hardware biometrics, we don't need to load face models
        // Just show ready status
        const typeName = bioType === 'face_hardware' ? 'Face ID' : 'بصمة إصبعك';
        const icon = bioType === 'face_hardware' ? '📱' : '👆';
        setStatus(`✅ النظام جاهز. اضغط زر الحضور للتحقق من ${icon} ${typeName}`, 'success-text');
    } catch(e) {
        setStatus('⚠️ خطأ في تهيئة نظام البصمة', 'error-text');
    }
}

// Unified biometric verification function
async function verifyBiometric() {
    const userBioType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : null);
    
    if (!userBioType) {
        return { success: false, message: 'لم يتم تسجيل بصمة' };
    }
    
    if (userBioType === 'face') {
        // Camera-based face verification is handled continuously by startVideo
        return { success: isBiometricVerified, message: isBiometricVerified ? 'تم التحقق' : 'الوجه غير متطابق' };
    } else if (userBioType === 'fingerprint' || userBioType === 'face_hardware') {
        // Hardware biometric needs explicit verification on button click
        return await verifyHardwareBiometric(userBioType);
    }
    
    return { success: false, message: 'نوع بصمة غير معروف' };
}

// Device Fingerprint - unique identifier for hardware biometric binding
function getDeviceFingerprint() {
    const nav = navigator;
    const screen = window.screen;
    const components = [
        nav.userAgent,
        nav.language,
        nav.platform,
        screen.width + 'x' + screen.height,
        screen.colorDepth,
        nav.hardwareConcurrency,
        nav.deviceMemory || 'unknown'
    ];
    // Simple hash function
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16) + '-' + components[0].slice(0, 20);
}

// Submit device change request to admin
async function submitDeviceChangeRequest(deviceId, deviceInfo) {
    try {
        document.getElementById('loader').classList.remove('hidden');
        
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submitDeviceChangeRequest',
                employeeId: currentUser.id,
                employeeName: currentUser.name,
                newDeviceInfo: {
                    deviceId: deviceId,
                    deviceModel: deviceInfo.deviceModel,
                    osType: deviceInfo.osType,
                    browserInfo: deviceInfo.browserInfo
                },
                reason: 'طلب تغيير الجهاز للموظف'
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        
        const result = await res.json();
        if (result.success) {
            alert('✅ تم إرسال طلب تغيير الجهاز بنجاح. سيتم مراجعة الطلب من قبل الإدارة.');
        } else {
            alert('⚠️ ' + result.message);
        }
    } catch (e) {
        console.error('Device change request error:', e);
        alert('❌ حدث خطأ أثناء إرسال الطلب');
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

async function verifyHardwareBiometric(bioType) {
    try {
        const biometricData = currentUser.biometricData || currentUser.faceDescriptor;
        const result = await biometricManager.authenticate(biometricData);
        if (result.success) {
            isBiometricVerified = true;
            currentBiometricVerification = { type: bioType, data: biometricData };
            updateActionButtonsState();
        }
        return result;
    } catch (e) {
        return { success: false, message: e.message };
    }
}

async function checkCurrentStatus() {
    try {
        const res = await fetch(`${API_URL}?action=getAttendance&employeeId=${currentUser.id}`);
        const result = await res.json();
        if (result.success && result.data.length > 0) {
            const lastRecord = result.data[result.data.length - 1];
            const isCheckedIn = (lastRecord.checkIn && !lastRecord.checkOut);
            
            if (isCheckedIn) {
                setAppState('in', lastRecord.checkIn);
            } else {
                setAppState('out');
            }
        } else {
            setAppState('out');
        }
    } catch(e) {
        console.error("Status check failed", e);
        setAppState('out'); 
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
    updateActionButtonsState();
}

function updateActionButtonsState() {
    const btnIn = document.getElementById('btnCheckIn');
    const btnOut = document.getElementById('btnCheckOut');
    
    const userBioType = currentUser?.biometricType || (currentUser?.faceDescriptor ? 'face' : null);
    
    let shouldBeEnabled;
    if (userBioType === 'fingerprint' || userBioType === 'face_hardware') {
        // Hardware: enable if at valid site (verification happens on click)
        shouldBeEnabled = !!lastDetectedSite;
    } else if (userBioType === 'face') {
        // Camera: need both face verified and valid site
        shouldBeEnabled = (isBiometricVerified || isFaceVerified) && lastDetectedSite;
    } else {
        // No biometric registered - disable buttons
        shouldBeEnabled = false;
    }
    
    if (btnIn) btnIn.disabled = !shouldBeEnabled;
    if (btnOut) btnOut.disabled = !shouldBeEnabled;
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

    // Also stop face detection to save battery
    if (faceDetectionInterval) {
        clearInterval(faceDetectionInterval);
        faceDetectionInterval = null;
    }
}

function setStatus(msg, className) {
    const el = document.getElementById('statusMessage');
    if(el) { el.innerText = msg; el.className = className; }
}

// Helper: Start video for one-time face verification (used when hardware biometric fails)
let verificationVideoStream = null;
let verificationVideoElement = null;

async function startVideoForVerification() {
    // Create temporary video element if not exists
    if (!verificationVideoElement) {
        verificationVideoElement = document.createElement('video');
        verificationVideoElement.style.position = 'fixed';
        verificationVideoElement.style.top = '50%';
        verificationVideoElement.style.left = '50%';
        verificationVideoElement.style.transform = 'translate(-50%, -50%)';
        verificationVideoElement.style.width = '300px';
        verificationVideoElement.style.height = '225px';
        verificationVideoElement.style.zIndex = '9999';
        verificationVideoElement.style.borderRadius = '10px';
        verificationVideoElement.style.boxShadow = '0 4px 20px rgba(0,0,0,0.5)';
        document.body.appendChild(verificationVideoElement);
        
        // Add overlay text
        const overlay = document.createElement('div');
        overlay.id = 'verificationOverlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -80%)';
        overlay.style.zIndex = '10000';
        overlay.style.background = 'rgba(0,0,0,0.7)';
        overlay.style.color = 'white';
        overlay.style.padding = '10px 20px';
        overlay.style.borderRadius = '5px';
        overlay.innerText = '👤 يرجى النظر للكاميرا للتحقق من الوجه';
        document.body.appendChild(overlay);
    }
    
    try {
        verificationVideoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' } 
        });
        verificationVideoElement.srcObject = verificationVideoStream;
        verificationVideoElement.play();
        
        // Wait for video to be ready
        await new Promise((resolve) => {
            verificationVideoElement.onloadedmetadata = () => {
                setTimeout(resolve, 1000); // Give time for focus/exposure
            };
        });
    } catch (err) {
        console.error('Camera error:', err);
        throw new Error('لا يمكن الوصول للكاميرا');
    }
}

async function captureAndVerifyFace() {
    if (!verificationVideoElement || !verificationVideoStream) {
        return { success: false, message: 'الكاميرا غير جاهزة' };
    }
    
    try {
        // Ensure face-api models are loaded
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        
        // Create face matcher with registered face
        const storedDescriptor = currentUser.faceDescriptor || 
            (currentUser.biometricData && currentUser.biometricType === 'face' ? currentUser.biometricData : null);
        
        if (!storedDescriptor) {
            cleanupVerificationVideo();
            return { success: false, message: 'لا يوجد بصمة وجه مسجلة للموظف' };
        }
        
        const parsedDescriptor = typeof storedDescriptor === 'string' 
            ? JSON.parse(storedDescriptor) 
            : storedDescriptor;
        
        const labeledDescriptor = new faceapi.LabeledFaceDescriptors(
            'employee', 
            [new Float32Array(parsedDescriptor)]
        );
        const matcher = new faceapi.FaceMatcher(labeledDescriptor, 0.6);
        
        // Detect face from video
        const detection = await faceapi.detectSingleFace(
            verificationVideoElement, 
            new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
        ).withFaceLandmarks().withFaceDescriptor();
        
        if (!detection) {
            cleanupVerificationVideo();
            return { success: false, message: 'لم يتم التعرف على وجه - يرجى المحاولة مرة أخرى' };
        }
        
        // Match against stored face
        const bestMatch = matcher.findBestMatch(detection.descriptor);
        
        // Cleanup
        cleanupVerificationVideo();
        
        if (bestMatch.label === 'unknown') {
            return { success: false, message: 'الوجه غير متطابق - ممنوع استخدام PIN/Password' };
        }
        
        return { 
            success: true, 
            descriptor: Array.from(detection.descriptor),
            message: 'تم التحقق من الوجه بنجاح'
        };
        
    } catch (e) {
        cleanupVerificationVideo();
        return { success: false, message: 'خطأ في التحقق: ' + e.message };
    }
}

function cleanupVerificationVideo() {
    if (verificationVideoStream) {
        verificationVideoStream.getTracks().forEach(track => track.stop());
        verificationVideoStream = null;
    }
    if (verificationVideoElement) {
        verificationVideoElement.remove();
        verificationVideoElement = null;
    }
    const overlay = document.getElementById('verificationOverlay');
    if (overlay) overlay.remove();
}

// Update Face ID Ring state: 'scanning' (white), 'success' (green), 'error' (red)
function updateFaceIDRing(state) {
    const ring = document.getElementById('faceIdRing');
    if (!ring) return;
    
    // Remove all state classes
    ring.classList.remove('scanning', 'success', 'error');
    
    // Add new state class
    if (state === 'scanning') {
        ring.classList.add('scanning');
    } else if (state === 'success') {
        ring.classList.add('success');
    } else if (state === 'error') {
        ring.classList.add('error');
    }
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

        // Clear any existing interval
        if (faceDetectionInterval) clearInterval(faceDetectionInterval);

        faceDetectionInterval = setInterval(async () => {
            // Skip if still processing previous frame or no matcher ready
            if (isDetecting || !faceMatcher) return;

            // Pause detection for 5 seconds after 3 consecutive successful verifications
            if (consecutiveSuccessFrames >= 3) {
                setStatus('✓ تم التحقق - جاري الراحة للحفاظ على البطارية', 'success-text');
                return;
            }

            isDetecting = true;

            try {
                // Use lighter options for mobile
                const options = new faceapi.SsdMobilenetv1Options({
                    minConfidence: 0.5,  // Higher threshold = faster processing
                    maxResults: 1        // Only need one face
                });

                const detections = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();

                // Clear canvas - no blue box, using Face ID ring instead
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                if (detections) {
                    const bestMatch = faceMatcher.findBestMatch(detections.descriptor);
                    if (bestMatch.label !== 'unknown') {
                        currentFaceDescriptor = Array.from(detections.descriptor);
                        isFaceVerified = true;
                        // Update unified biometric status
                        isBiometricVerified = true;
                        currentBiometricVerification = { 
                            type: 'face', 
                            data: Array.from(detections.descriptor) 
                        };
                        consecutiveSuccessFrames++;
                        
                        // Update Face ID ring to success (green)
                        updateFaceIDRing('success');
                        
                        // Update status - check if location already detected
                        const currentStatus = document.getElementById('statusMessage')?.innerText || '';
                        if (currentStatus.includes('الموقع') || lastDetectedSite) {
                            setStatus('✓ تم التحقق من الوجه والموقع', 'success-text');
                        } else {
                            setStatus('تم التحقق من الوجه بنجاح ✓', 'success-text');
                        }
                        
                        // Ensure buttons are updated immediately
                        updateActionButtonsState();

                        // Reset counter after 5 seconds to resume checking
                        if (consecutiveSuccessFrames === 3) {
                            setTimeout(() => { 
                                consecutiveSuccessFrames = 0; 
                                updateFaceIDRing('scanning');
                            }, 5000);
                        }
                    } else {
                        setStatus('الوجه غير متطابق', 'error-text');
                        currentFaceDescriptor = null;
                        isFaceVerified = false;
                        isBiometricVerified = false;
                        currentBiometricVerification = null;
                        consecutiveSuccessFrames = 0;
                        // Update Face ID ring to error (red)
                        updateFaceIDRing('error');
                    }
                } else {
                    setStatus('وجه الكاميرا إليك', 'text-muted');
                    currentFaceDescriptor = null;
                    isFaceVerified = false;
                    isBiometricVerified = false;
                    currentBiometricVerification = null;
                    consecutiveSuccessFrames = 0;
                    // Reset to scanning state
                    updateFaceIDRing('scanning');
                }
                updateActionButtonsState();
            } catch (err) {
                console.warn('Face detection error:', err);
            } finally {
                isDetecting = false;
            }
        }, 1500); // Reduced from 1000ms to 1500ms for older devices
    });
}

async function getLocation() {
    if (!navigator.geolocation) {
        setStatus('المتصفح لا يدعم تحديد الموقع', 'error-text');
        return;
    }

    // Check permission state first (if Permissions API is supported)
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const result = await navigator.permissions.query({ name: 'geolocation' });
            if (result.state === 'denied') {
                setStatus('تم رفض إذن الموقع - افتح إعدادات المتصفح واسمح بالموقع', 'error-text');
                return;
            }
        } catch (e) {
            // Permissions API might not support geolocation on some browsers
        }
    }

    // Clear existing watch to prevent multiple watchers
    if (geolocationWatchId !== null) {
        navigator.geolocation.clearWatch(geolocationWatchId);
    }

    setStatus('جاري تحديد الموقع...', 'text-muted');

    // Try high-accuracy fresh position first (most accurate)
    tryGetPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, // Fresh, high accuracy
        (position) => onPositionSuccess(position),
        (error) => {
            // Fallback: try low-accuracy fresh position
            tryGetPosition(
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 },
                (position) => onPositionSuccess(position),
                (error2) => {
                    // Last resort: accept cached position up to 5 min old
                    tryGetPosition(
                        { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
                        (position) => onPositionSuccess(position),
                        (error3) => handleGeoError(error3)
                    );
                }
            );
        }
    );
}

function tryGetPosition(options, onSuccess, onError) {
    navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
}

function onPositionSuccess(position) {
    lastLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
    verifyLocation();
    // Don't overwrite face verification status - append to it or keep it
    const currentStatus = document.getElementById('statusMessage')?.innerText || '';
    if (currentStatus.includes('التحقق من الوجه') || isBiometricVerified) {
        setStatus('✓ تم التحقق من الوجه والموقع', 'success-text');
    } else {
        setStatus('تم تحديد الموقع ✓', 'success-text');
    }
    // Ensure buttons are updated immediately after location detected
    updateActionButtonsState();
    startWatchingPosition();
}

function startWatchingPosition() {
    geolocationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            lastLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            verifyLocation();
        },
        (error) => {
            // Silent fail on watch errors - we already have initial position
            console.warn('Watch position error:', error);
        },
        {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}

function handleGeoError(error) {
    let msg = 'خطأ في تحديد الموقع';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            msg = 'تم رفض إذن الموقع - افتح إعدادات المتصفح واسمح بالموقع';
            break;
        case error.POSITION_UNAVAILABLE:
            msg = 'إشارة GPS ضعيفة - حاول في مكان مفتوح';
            break;
        case error.TIMEOUT:
            msg = 'استغرق تحديد الموقع وقتًا طويلاً - تأكد من تشغيل GPS';
            break;
    }
    setStatus(msg, 'error-text');
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
        lastDetectedSite = detectedSite;
    } else {
        const distText = minDistance === Infinity ? "" : `(أقرب موقع لك هو ${closestSiteName} ويبعد ${(minDistance/1000).toFixed(2)} كم)`;
        document.getElementById('siteText').innerText = `❌ أنت خارج النطاق. ${distText}`;
        document.getElementById('btnRequestSite').classList.remove('hidden');
        lastDetectedSite = null;
    }
    updateActionButtonsState();
}

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = deg2rad(lat2-lat1);  const dLon = deg2rad(lon2-lon1); 
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c * 1000;
}
function deg2rad(deg) { return deg * (Math.PI/180) }

// Vibration feedback functions
function vibrateSuccess() {
    try {
        if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]); // Short vibration pattern
        }
    } catch (e) {
        console.warn('Vibration failed:', e);
    }
}

function vibrateError() {
    try {
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200, 100, 200]); // Longer error pattern
        }
    } catch (e) {
        console.warn('Vibration failed:', e);
    }
}

async function handleCheckIn() {
    if(isCheckInProgress) return; // Prevent duplicate clicks
    if(!lastLocation) return alert('يجب تفعيل الـ GPS');
    
    // Check biometric verification based on user type
    const userBioType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : null);
    let finalBioType = userBioType;
    let finalBiometricData = null;
    
    if (userBioType === 'fingerprint' || userBioType === 'face_hardware') {
        // For hardware biometrics, verify on button click
        const result = await verifyHardwareBiometric(userBioType);
        if (result.success) {
            // Hardware biometric verified successfully
            finalBiometricData = currentBiometricVerification?.data;
        } else {
            // Hardware biometric failed (possibly PIN used) - FALLBACK to camera face
            if (currentUser.faceDescriptor) {
                alert('⚠️ لم يتم التحقق من بصمة الجهاز. جاري التحقق من بصمة الوجه...');
                // Start camera for face verification
                await startVideoForVerification();
                const faceResult = await captureAndVerifyFace();
                if (!faceResult.success) {
                    return alert('❌ فشل التحقق: ' + faceResult.message);
                }
                finalBioType = 'face';
                finalBiometricData = faceResult.descriptor;
            } else {
                const typeName = userBioType === 'face_hardware' ? 'Face ID' : 'بصمة الإصبع';
                return alert(`❌ فشل التحقق من ${typeName}: ` + result.message);
            }
        }
    } else if (userBioType === 'face') {
        // For camera face, check if already verified continuously
        if (!isBiometricVerified && !currentFaceDescriptor) {
            return alert('بصمة الوجه غير ملتقطة الحين');
        }
        finalBiometricData = currentFaceDescriptor;
    } else {
        return alert('لم يتم تسجيل بصمة. يرجى التواصل مع HR');
    }

    isCheckInProgress = true;
    document.getElementById('loader').classList.remove('hidden');
    
    // Get device fingerprint and info
    const deviceId = getDeviceFingerprint();
    const deviceInfo = {
        deviceModel: navigator.platform || 'Unknown',
        osType: navigator.userAgent.split('(')[1]?.split(')')[0] || 'Unknown',
        browserInfo: navigator.userAgent
    };

    // Prepare biometric data for payload
    const payload = {
        action: 'addAttendance', employeeId: currentUser.id, employeeName: currentUser.name,
        checkIn: new Date().toISOString(), latitude: lastLocation.lat, longitude: lastLocation.lng,
        biometricType: finalBioType,
        biometricData: finalBiometricData ? JSON.stringify(finalBiometricData) : null,
        faceDescriptor: finalBiometricData ? JSON.stringify(finalBiometricData) : null, // Legacy support
        deviceId: deviceId,
        deviceInfo: deviceInfo
    };

    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            playSuccessSound(); // Play success sound
            vibrateSuccess(); // Vibrate for success
            setAppState('in', payload.checkIn);
        } else if (result.duplicateEntry) {
            // Duplicate entry detected (same timestamp) - show warning but no error sound needed
            alert('⚠️ ' + result.message);
        } else if (result.openSession && result.openSessionId) {
            // There's a same-day open session — offer to force-close it
            const confirmed = confirm(
                'لديك جلسة حضور مفتوحة من قبل بنفس اليوم.\n' +
                'هل تريد إغلاقها وتسجيل حضور جديد الآن؟'
            );
            if (confirmed) {
                await forceCloseAndRecheckIn(result.openSessionId, payload);
            }
        } else if (result.deviceRejected) {
            // Device not authorized - show change request option
            if (result.hasPendingRequest) {
                alert('❌ ' + result.message);
            } else {
                const requestChange = confirm(
                    '❌ ' + result.message + '\n\n' +
                    'هل تريد إرسال طلب لتغيير الجهاز إلى الإدارة؟'
                );
                if (requestChange) {
                    await submitDeviceChangeRequest(deviceId, deviceInfo);
                }
            }
            playErrorSound();
            vibrateError();
        } else {
            alert('خطأ: ' + result.message);
            playErrorSound(); // Play error sound
            vibrateError(); // Vibrate for error
        }
    } catch(e) { 
        console.error('Check-in Error:', e); 
        alert('حدث خطأ في الاتصال: ' + (e.message || 'تفاصيل في الـ console')); 
        playErrorSound(); 
        vibrateError(); 
    } finally {
        isCheckInProgress = false;
        document.getElementById('loader').classList.add('hidden');
    }
}

async function forceCloseAndRecheckIn(openSessionId, originalPayload) {
    document.getElementById('loader').classList.remove('hidden');
    
    // Prepare biometric data
    const userBioType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : null);
    const biometricData = currentBiometricVerification?.data || currentFaceDescriptor;
    
    try {
        // Step 1: Close the old session
        const closeRes = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'checkoutAttendance',
                employeeId: currentUser.id,
                attendanceId: openSessionId,
                checkOut: new Date().toISOString(),
                latitude: lastLocation ? lastLocation.lat : 0,
                longitude: lastLocation ? lastLocation.lng : 0,
                biometricType: userBioType,
                biometricData: biometricData ? JSON.stringify(biometricData) : null,
                faceDescriptor: biometricData ? JSON.stringify(biometricData) : null
            }),
            headers: { 'Content-Type': 'text/plain' }
        });
        const closeResult = await closeRes.json();
        if (!closeResult.success) {
            alert('فشل إغلاق الجلسة القديمة: ' + closeResult.message);
            playErrorSound(); // Play error sound
            return;
        }
        
        // Step 2: Re-attempt check-in
        const retryRes = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(originalPayload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const retryResult = await retryRes.json();
        if (retryResult.success) {
            alert('✅ تم إغلاق الجلسة القديمة وتسجيل الحضور بنجاح!');
            playSuccessSound(); // Play success sound
            setAppState('in', originalPayload.checkIn);
        } else {
            alert('خطأ عند إعادة تسجيل الحضور: ' + retryResult.message);
            playErrorSound(); // Play error sound
        }
    } catch(e) {
        console.error(e);
        alert('حدث خطأ في الاتصال');
        playErrorSound(); // Play error sound
    }
    document.getElementById('loader').classList.add('hidden');
}

async function handleCheckOut() {
    if(!lastLocation) return alert('يجب تفعيل الـ GPS');
    
    // Check biometric verification based on user type
    const userBioType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : null);
    let finalBioType = userBioType;
    let finalBiometricData = null;
    
    if (userBioType === 'fingerprint' || userBioType === 'face_hardware') {
        // For hardware biometrics, verify on button click
        const result = await verifyHardwareBiometric(userBioType);
        if (result.success) {
            // Hardware biometric verified successfully
            finalBiometricData = currentBiometricVerification?.data;
        } else {
            // Hardware biometric failed (possibly PIN used) - FALLBACK to camera face
            if (currentUser.faceDescriptor) {
                alert('⚠️ لم يتم التحقق من بصمة الجهاز. جاري التحقق من بصمة الوجه...');
                // Start camera for face verification
                await startVideoForVerification();
                const faceResult = await captureAndVerifyFace();
                if (!faceResult.success) {
                    return alert('❌ فشل التحقق: ' + faceResult.message);
                }
                finalBioType = 'face';
                finalBiometricData = faceResult.descriptor;
            } else {
                const typeName = userBioType === 'face_hardware' ? 'Face ID' : 'بصمة الإصبع';
                return alert(`❌ فشل التحقق من ${typeName}: ` + result.message);
            }
        }
    } else if (userBioType === 'face') {
        // For camera face, check if already verified continuously
        if (!isBiometricVerified && !currentFaceDescriptor) {
            return alert('بصمة الوجه غير ملتقطة الحين');
        }
        finalBiometricData = currentFaceDescriptor;
    } else {
        return alert('لم يتم تسجيل بصمة. يرجى التواصل مع HR');
    }

    document.getElementById('loader').classList.remove('hidden');
    
    // Prepare biometric data for payload
    const payload = { 
        action: 'checkoutAttendance', employeeId: currentUser.id, 
        checkOut: new Date().toISOString(), latitude: lastLocation.lat, longitude: lastLocation.lng,
        biometricType: finalBioType,
        biometricData: finalBiometricData ? JSON.stringify(finalBiometricData) : null,
        faceDescriptor: finalBiometricData ? JSON.stringify(finalBiometricData) : null
    };
    try {
        const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain' } });
        const result = await res.json();
        if(result.success) {
            alert(result.message);
            playSuccessSound(); // Play success sound
            setAppState('out');
        }
        else {
            alert('خطأ: ' + result.message);
            playErrorSound(); // Play error sound
        }
    } catch(e) { console.error(e); alert('حدث خطأ في الشبكة: ' + e.message); playErrorSound(); }
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

// ------ ALLOWANCE REQUEST LOGIC ------ //
function openAllowanceModal() {
    try {
        const modal = document.getElementById('allowanceRequestModal');
        const dateInput = document.getElementById('allowanceDate');
        if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex'; // Ensure it shows even with inline flex
        }
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
        fetchEligibleSites(); 
    } catch (e) {
        console.error("Error opening allowance modal", e);
        alert("حدث خطأ أثناء فتح النافذة");
    }
}

function closeAllowanceModal() {
    const modal = document.getElementById('allowanceRequestModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

async function fetchEligibleSites() {
    const date = document.getElementById('allowanceDate').value;
    const select = document.getElementById('allowanceSiteSelect');
    const container = document.getElementById('eligibleSitesContainer');
    
    if (!date) return;

    try {
        const res = await fetch(`${API_URL}?action=getEligibleAttendance&employeeId=${currentUser.id}&date=${date}`);
        const result = await res.json();
        
        select.innerHTML = '';
        if (result.success && result.data.length > 0) {
            result.data.forEach(att => {
                const time = formatCairoTime(att.checkIn);
                const option = document.createElement('option');
                option.value = att.id;
                option.dataset.siteId = att.siteId;
                option.dataset.siteName = att.siteName;
                option.innerText = `${att.siteName} (بصمة الساعة ${time})`;
                select.appendChild(option);
            });
            container.classList.remove('hidden');
        } else {
            const option = document.createElement('option');
            option.value = "";
            option.innerText = "لا يوجد سجل حضور لهذا اليوم";
            select.appendChild(option);
            container.classList.remove('hidden');
        }
    } catch (e) {
        console.error(e);
    }
}

async function submitAllowanceRequest() {
    const date = document.getElementById('allowanceDate').value;
    const attId = document.getElementById('allowanceSiteSelect').value;
    const amount = document.getElementById('allowanceExtraAmount').value;
    const note = document.getElementById('allowanceNote').value;

    if (!attId) return alert("يجب اختيار يوم به سجل حضور");
    if (!amount || parseFloat(amount) <= 0) return alert("يرجى إدخال مبلغ صحيح");

    const selectedOption = document.getElementById('allowanceSiteSelect').selectedOptions[0];
    
    const payload = {
        action: 'addAllowanceRequest',
        employeeId: currentUser.id,
        employeeName: currentUser.name,
        attendanceId: attId,
        siteId: selectedOption.dataset.siteId,
        siteName: selectedOption.dataset.siteName,
        requestDate: date,
        amount: amount,
        note: note
    };

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            closeAllowanceModal();
        } else {
            alert("خطأ: " + result.message);
        }
    } catch (e) {
        console.error(e);
        alert("فشل الاتصال بالسيرفر");
    }
    document.getElementById('loader').classList.add('hidden');
}

// ------ LEAVE REQUEST LOGIC ------ //
function openLeaveModal() {
    try {
        const modal = document.getElementById('leaveRequestModal');
        const dateInput = document.getElementById('leaveDate');
        if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
        }
        if (dateInput) {
            // Set default to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateInput.value = tomorrow.toISOString().split('T')[0];
        }
        // Clear reason
        const reasonInput = document.getElementById('leaveReason');
        if (reasonInput) reasonInput.value = '';
    } catch (e) {
        console.error("Error opening leave modal", e);
        alert("حدث خطأ أثناء فتح النافذة");
    }
}

function closeLeaveModal() {
    const modal = document.getElementById('leaveRequestModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

async function submitLeaveRequest() {
    const leaveDate = document.getElementById('leaveDate').value;
    const reason = document.getElementById('leaveReason').value.trim();

    if (!leaveDate) return alert("يجب اختيار تاريخ الإجازة");
    if (!reason) return alert("يجب كتابة سبب الإجازة");

    const payload = {
        action: 'addLeaveRequest',
        employeeId: currentUser.id,
        employeeName: currentUser.name,
        leaveDate: leaveDate,
        reason: reason
    };

    document.getElementById('loader').classList.remove('hidden');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            closeLeaveModal();
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
        // Fetch attendance, employee data, and leave requests in parallel
        const [attRes, empRes, leaveRes] = await Promise.all([
            fetch(`${API_URL}?action=getAttendance&employeeId=${currentUser.id}`),
            fetch(`${API_URL}?action=getEmployees`),
            fetch(`${API_URL}?action=getLeaveRequests&employeeId=${currentUser.id}`)
        ]);
        const attResult = await attRes.json();
        const empResult = await empRes.json();
        const leaveResult = await leaveRes.json();

        if(attResult.success) {
            allLeaveRequests = leaveResult.success ? (leaveResult.data || []) : [];
            // Update currentUser with fresh data including salary and siteAllowances
            if(empResult.success && empResult.data) {
                const empData = empResult.data.find(e => String(e.id) === String(currentUser.id));
                if(empData) {
                    currentUser = { 
                        ...currentUser, 
                        salary: empData.salary,
                        siteAllowances: empData.siteAllowances || []
                    };
                }
            }
            renderMyReports(attResult.data, monthVal);
        }
    } catch(e) { console.error('خطأ في جلب التقارير', e); }
    document.getElementById('loader').classList.add('hidden');
}

function getWorkingDaysPassed(year, month) {
    let days = 0;
    const today = new Date();
    const endDay = (year === today.getFullYear() && month === today.getMonth()) ? today.getDate() : new Date(year, month + 1, 0).getDate();

    // Build a Set of official holiday dates for quick lookup
    const holidayDates = new Set();
    allOfficialHolidays.forEach(h => {
        if (h.holidayDate) {
            const d = new Date(h.holidayDate);
            if (!isNaN(d)) {
                // Format using local date components (not toISOString which converts to UTC)
                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                holidayDates.add(dateKey);
            }
        }
    });

    for (let i = 1; i <= endDay; i++) {
        const d = new Date(year, month, i);
        // Format date as YYYY-MM-DD using local date components (not toISOString which converts to UTC)
        const currentDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const isWeekend = weekendDays.includes(d.getDay()); // Use configured weekend days
        const isHoliday = holidayDates.has(currentDateKey);

        // Exclude weekends and official holidays
        if (!isWeekend && !isHoliday) {
            days++;
        }
    }
    return days;
}

function toTransportNumber(value) {
    const parsed = parseFloat(value || 0);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function getCurrentTransportPrice(record) {
    const allowance = currentUser && currentUser.siteAllowances ? 
        currentUser.siteAllowances.find(a => String(a.siteId) === String(record.siteId)) : null;
    
    if (allowance) {
        const site = sitesData.find(s => String(s.id) === String(record.siteId));
        const siteDefault = site ? toTransportNumber(site.transportPrice) : 120;
        
        const hierarchyPrice = parseFloat(allowance.transportPrice || 0);
        const recordPrice = toTransportNumber(record.transportPrice);
        
        const baseDefault = siteDefault > 0 ? siteDefault : 120;
        const manualIncrease = recordPrice > baseDefault ? recordPrice - baseDefault : 0;
        
        return hierarchyPrice + manualIncrease;
    }
    
    return toTransportNumber(record.transportPrice);
}

function getWeekendDaysFromSettings() {
    // Default: Friday (5) and Saturday (6)
    const weekendDaysStr = appSettings.weekendDays || "5,6";
    const days = weekendDaysStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
    console.log('appSettings:', appSettings, 'weekendDays:', days);
    return days;
}

function renderMyReports(data, monthStr) {
    const targetYear = parseInt(monthStr.split('-')[0]);
    const targetMonth = parseInt(monthStr.split('-')[1]) - 1;
    const now = new Date();
    const weekendDays = getWeekendDaysFromSettings();

    // 1. Get all present days in this month
    const presentRecords = data.filter(record => {
        const recordDateStr = record.checkIn ? record.checkIn.slice(0, 7) : ''; // YYYY-MM
        return recordDateStr === monthStr;
    });

    // 2. Identify working days that passed (exclude configured weekend days)
    const workingDaysPassed = [];
    const endDay = (targetYear === now.getFullYear() && targetMonth === now.getMonth())
                   ? now.getDate()
                   : new Date(targetYear, targetMonth + 1, 0).getDate();

    // Build a Set of official holiday dates for quick lookup
    const holidayDates = new Set();
    allOfficialHolidays.forEach(h => {
        if (h.holidayDate) {
            const d = new Date(h.holidayDate);
            if (!isNaN(d)) {
                // Format using local date components (not toISOString which converts to UTC)
                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                holidayDates.add(dateKey);
            }
        }
    });

    for (let i = 1; i <= endDay; i++) {
        const d = new Date(targetYear, targetMonth, i);
        // Format date as YYYY-MM-DD using local date components (not toISOString which converts to UTC)
        const currentDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const dayOfWeek = d.getDay();
        const isWeekend = weekendDays.includes(dayOfWeek); // Use configured weekend days
        const isHoliday = holidayDates.has(currentDateKey);

        // Debug: log day 25
        if (i === 25) {
            console.log('renderMyReports Day 25:', currentDateKey, 'dayOfWeek:', dayOfWeek, 'isWeekend:', isWeekend, 'weekendDays:', weekendDays);
        }

        // Exclude weekends and official holidays
        if (!isWeekend && !isHoliday) {
            workingDaysPassed.push(currentDateKey);
        }
    }

    // Create a map for approved leaves for quick lookup
    const approvedLeavesByDate = {};
    allLeaveRequests.forEach(req => {
        if (req.status === 'approved') {
            const dateStr = req.leaveDate.split('T')[0];
            approvedLeavesByDate[dateStr] = req;
        }
    });

    let totalTransport = 0;
    const dailyTransport = {};
    
    const tbody = document.getElementById('myReportsTableBody');
    tbody.innerHTML = '';

    // Helper function to check if a date is an overtime day (weekend or holiday)
    function isOvertimeDay(dateStr) {
        const d = new Date(dateStr);
        const dayOfWeek = d.getDay();
        const isWeekend = weekendDays.includes(dayOfWeek);
        const isHoliday = holidayDates.has(dateStr);
        return isWeekend || isHoliday;
    }

    // Create sets for different day types
    const presentDates = new Set();
    const lateDates = new Set();
    const overtimeDates = new Set();

    presentRecords.forEach(r => {
        const dateKey = r.checkIn ? r.checkIn.slice(0, 10) : '';
        if (!dateKey) return;

        // Check if this is an overtime day (weekend/holiday work)
        const isOvertime = r.status === 'overtime' || (isOvertimeDay(dateKey) && r.status !== 'late' && r.status !== 'present');

        if (r.status === 'late') {
            lateDates.add(dateKey);
        }

        if (isOvertime) {
            overtimeDates.add(dateKey);
        } else {
            presentDates.add(dateKey);
        }
    });

    let totalLates = lateDates.size; // Only count one late per unique date
    let totalOvertime = overtimeDates.size; // Only count one overtime per unique date
    const fullReport = [];

    // Add Present Records
    presentRecords.forEach(record => {
        const dateKey = record.checkIn ? record.checkIn.slice(0, 10) : null;

        if (dateKey) {
            const transportValue = getCurrentTransportPrice(record);
            if (!(dateKey in dailyTransport)) {
                dailyTransport[dateKey] = transportValue;
            } else if (transportValue > dailyTransport[dateKey]) {
                dailyTransport[dateKey] = transportValue;
            }
        }
        fullReport.push({
            date: record.checkIn, // Keep as ISO string
            checkIn: record.checkIn,
            checkOut: record.checkOut,
            siteName: record.siteName || '-',
            status: record.status, // 'present' or 'late'
            transport: getCurrentTransportPrice(record),
            type: 'entry'
        });
    });

    totalTransport = Object.values(dailyTransport).reduce((sum, value) => sum + value, 0);

    let approvedLeavesOnWorkingDaysCount = 0;
    // Add Absent or Leave Days (Only for working days that have no record)
    workingDaysPassed.forEach(dateStr => {
        if (!presentDates.has(dateStr)) {
            if (approvedLeavesByDate[dateStr]) {
                approvedLeavesOnWorkingDaysCount++;
                fullReport.push({
                    date: dateStr + 'T00:00:00+02:00',
                    type: 'leave',
                    reason: approvedLeavesByDate[dateStr].reason || 'إجازة معتمدة'
                });
            } else {
                fullReport.push({
                    date: dateStr + 'T00:00:00+02:00', // Keep as ISO string format
                    type: 'absent'
                });
            }
        }
    });

    // Sort by date descending (compare ISO strings)
    fullReport.sort((a, b) => new Date(b.date) - new Date(a.date));

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
            } else if (item.status === 'no_checkout') {
                statusText = 'لم يتم الانصراف';
                statusColor = '#f59e0b';
            }

            let checkOutDisplay = '-';
            if (item.status === 'no_checkout') {
                checkOutDisplay = 'لم يتم الانصراف';
            } else if (item.checkOut) {
                checkOutDisplay = formatCairoTime(item.checkOut);
            }

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--card-border);">
                    <td data-label="التاريخ" style="padding: 8px 5px;">${formatCairoDate(item.checkIn)}</td>
                    <td data-label="الحضور" style="padding: 8px 5px; font-family: monospace;">${formatCairoTime(item.checkIn)}</td>
                    <td data-label="الانصراف" style="padding: 8px 5px; font-family: monospace;">${checkOutDisplay}</td>
                    <td data-label="الموقع" style="padding: 8px 5px; font-size: 0.8rem;">${item.siteName || '-'}</td>
                    <td data-label="البدل" style="padding: 8px 5px;">${item.transport} ج.م</td>
                    <td data-label="الحالة" style="padding: 8px 5px;"><span style="color:${statusColor}; font-weight: bold;">${statusText}</span></td>
                </tr>
            `;
        } else if (item.type === 'leave') {
            // Leave Row
            tbody.innerHTML += `
                <tr style="background: rgba(16, 185, 129, 0.05); border-bottom: 1px solid var(--card-border);">
                    <td data-label="التاريخ" style="padding: 8px 5px;">${formatCairoDate(item.date)}</td>
                    <td data-label="التفاصيل" colspan="4" style="text-align:center !important; color:var(--secondary); font-size:0.8rem; padding: 8px 5px;">إجازة معتمدة: ${item.reason}</td>
                    <td data-label="الحالة" style="padding: 8px 5px;"><span style="color:var(--secondary); font-weight: bold;">إجازة</span></td>
                </tr>
            `;
        } else {
            // Absent Row
            tbody.innerHTML += `
                <tr style="background: rgba(239, 68, 68, 0.05); border-bottom: 1px solid var(--card-border);">
                    <td data-label="التاريخ" style="padding: 8px 5px;">${formatCairoDate(item.date)}</td>
                    <td data-label="التفاصيل" colspan="4" style="text-align:center !important; color:var(--danger); font-size:0.8rem; padding: 8px 5px;">غائب (لم يتم تسجيل حضور)</td>
                    <td data-label="الحالة" style="padding: 8px 5px;"><span style="color:var(--danger); font-weight: bold;">غائب</span></td>
                </tr>
            `;
        }
    });

    const totalAbsent = Math.max(workingDaysPassed.length - presentDates.size - approvedLeavesOnWorkingDaysCount, 0);

    // Calculate overtime pay based on employee salary
    const salary = currentUser.salary ? parseFloat(currentUser.salary) : 0;
    const dailyRate = salary / 30;
    const overtimePay = dailyRate * totalOvertime;

    document.getElementById('empTotalPresent').innerText = presentDates.size; // Use size of unique dates set
    document.getElementById('empTotalAbsent').innerText = totalAbsent > 0 ? totalAbsent : 0;
    document.getElementById('empTotalLates').innerText = totalLates;
    document.getElementById('empTotalOvertime').innerText = totalOvertime;
    document.getElementById('empTotalOvertimePay').innerText = overtimePay.toFixed(2) + " ج.م";
    document.getElementById('empTotalTransport').innerText = totalTransport.toFixed(2) + " ج.م";
}

// ============================================================
// BIOMETRIC UPDATE FUNCTIONS
// Allow employees to change/update their biometric type
// ============================================================

let bioUpdateType = null;
let bioUpdateData = null;
let bioUpdateVideoStream = null;

function openBiometricUpdateModal() {
    const modal = document.getElementById('biometricUpdateModal');
    const currentType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : 'none');
    
    // Show current biometric type
    const typeNames = {
        'face': '📷 بصمة الوجه (بالكاميرا)',
        'fingerprint': '👆 بصمة الإصبع',
        'face_hardware': '📱 Face ID',
        'none': '❌ لا يوجد'
    };
    
    document.getElementById('currentBioType').innerText = typeNames[currentType] || currentType;
    document.getElementById('currentBioDisplay').innerText = typeNames[currentType] || currentType;
    
    // Load available options
    loadBiometricUpdateOptions();
    
    // Hide sections
    document.getElementById('bioUpdateFaceSection').classList.add('hidden');
    document.getElementById('bioUpdateHardwareSection').classList.add('hidden');
    
    bioUpdateType = null;
    bioUpdateData = null;
    
    modal.classList.remove('hidden');
}

function closeBiometricUpdateModal() {
    const modal = document.getElementById('biometricUpdateModal');
    modal.classList.add('hidden');
    
    // Stop any active video stream
    if (bioUpdateVideoStream) {
        bioUpdateVideoStream.getTracks().forEach(track => track.stop());
        bioUpdateVideoStream = null;
    }
}

async function loadBiometricUpdateOptions() {
    const optionsDiv = document.getElementById('bioUpdateOptions');
    const available = await biometricManager.checkAvailableBiometrics();
    
    const currentType = currentUser.biometricType || (currentUser.faceDescriptor ? 'face' : 'none');
    
    let html = '<label style="display:block; margin-bottom:10px;">اختر البصمة الجديدة:</label>';
    html += '<div style="display:flex; flex-direction:column; gap:10px;">';
    
    available.forEach(bio => {
        const isCurrent = bio.type === currentType;
        const badge = isCurrent ? '<span style="background:var(--primary); padding:2px 8px; border-radius:4px; font-size:0.7rem; margin-right:5px;">الحالية</span>' : '';
        const speedBadge = bio.isHardware ? '<span style="background:var(--secondary); padding:2px 8px; border-radius:4px; font-size:0.7rem; margin-right:5px;">⚡ سريع</span>' : '';
        const recommended = bio.priority === 1 ? '<span style="background:#f59e0b; padding:2px 8px; border-radius:4px; font-size:0.7rem; margin-right:5px;">موصى به</span>' : '';
        
        html += `
            <button class="btn-primary" style="text-align:right; ${isCurrent ? 'opacity:0.6;' : ''} ${bio.priority === 1 ? 'background:var(--secondary);' : ''}"
                onclick="selectBioUpdateType('${bio.type}')" ${isCurrent ? 'disabled' : ''}>
                ${bio.icon} ${bio.name}
                <div style="font-size:0.75rem; margin-top:5px;">${badge}${speedBadge}${recommended}</div>
            </button>
        `;
    });
    
    html += '</div>';
    optionsDiv.innerHTML = html;
}

async function selectBioUpdateType(type) {
    bioUpdateType = type;
    bioUpdateData = null;
    
    // Hide all sections first
    document.getElementById('bioUpdateFaceSection').classList.add('hidden');
    document.getElementById('bioUpdateHardwareSection').classList.add('hidden');
    
    if (type === 'face') {
        // Camera-based face
        document.getElementById('bioUpdateFaceSection').classList.remove('hidden');
        
        // Start video
        const video = document.getElementById('bioUpdateVideo');
        try {
            bioUpdateVideoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
            video.srcObject = bioUpdateVideoStream;
        } catch (e) {
            alert('لا يمكن الوصول للكاميرا: ' + e.message);
        }
    } else if (type === 'fingerprint' || type === 'face_hardware') {
        // Hardware biometric
        document.getElementById('bioUpdateHardwareSection').classList.remove('hidden');
        
        const isFaceId = type === 'face_hardware';
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        const label = isFaceId ? (isIOS ? 'Face ID' : 'Face Unlock') : 'بصمة الإصبع';
        const icon = isFaceId ? '📱' : '👆';
        const desc = isFaceId ? 'استخدم بصمة وجهك للتسجيل' : 'اضغط الزر أدناه لتسجيل بصمة إصبعك';
        const btnText = isFaceId ? 'تسجيل Face ID' : 'تسجيل بصمة الإصبع';
        
        document.getElementById('bioUpdateHardwareIcon').innerText = icon;
        document.getElementById('bioUpdateHardwareDesc').innerText = desc;
        document.getElementById('bioUpdateHardwareBtn').innerText = btnText;
    }
}

async function captureBioUpdateFace() {
    const video = document.getElementById('bioUpdateVideo');
    const statusEl = document.getElementById('bioUpdateFaceStatus');
    
    statusEl.classList.remove('hidden');
    statusEl.innerText = 'جاري مسح الوجه...';
    statusEl.className = '';
    
    try {
        const result = await biometricManager.enroll('face', { videoElement: video, modelUrl: MODEL_URL });
        bioUpdateData = result;
        
        statusEl.innerText = '✓ تم التقاط بصمة الوجه بنجاح!';
        statusEl.className = 'success-text';
        playSuccessSound();
    } catch (e) {
        statusEl.innerText = '✗ ' + (e.message || 'فشل في التقاط الوجه');
        statusEl.className = 'error-text';
        playErrorSound();
    }
}

async function captureBioUpdateHardware() {
    const statusEl = document.getElementById('bioUpdateHardwareStatus');
    const isFaceId = bioUpdateType === 'face_hardware';
    
    statusEl.classList.remove('hidden');
    statusEl.innerText = isFaceId ? 'استخدم Face ID للتسجيل...' : 'ضع إصبعك على الماسح...';
    statusEl.className = '';
    
    try {
        const result = await biometricManager.enroll(bioUpdateType, { 
            userId: currentUser.id, 
            userName: currentUser.name 
        });
        bioUpdateData = result;
        
        const successMsg = isFaceId ? '✓ تم تسجيل Face ID بنجاح!' : '✓ تم تسجيل بصمة الإصبع بنجاح!';
        statusEl.innerText = successMsg;
        statusEl.className = 'success-text';
        playSuccessSound();
    } catch (e) {
        const errorMsg = isFaceId ? '✗ فشل في تسجيل Face ID' : '✗ فشل في تسجيل بصمة الإصبع';
        statusEl.innerText = errorMsg + ': ' + (e.message || '');
        statusEl.className = 'error-text';
        playErrorSound();
    }
}

async function saveBiometricUpdate() {
    if (!bioUpdateType || !bioUpdateData) {
        alert('اختر نوع البصمة وسجلها أولاً');
        return;
    }
    
    document.getElementById('loader').classList.remove('hidden');
    
    try {
        const payload = {
            action: 'updateEmployee',
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
            phone: currentUser.phone,
            role: currentUser.role,
            assignedSites: currentUser.assignedSites ? currentUser.assignedSites.join(',') : '',
            biometricType: bioUpdateData.type,
            biometricData: JSON.stringify(bioUpdateData),
            // Legacy field
            faceDescriptor: bioUpdateData.type === 'face' ? bioUpdateData.data : null
        };
        
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
        });
        
        const result = await res.json();
        
        if (result.success) {
            // Update local user data
            currentUser.biometricType = bioUpdateData.type;
            currentUser.biometricData = bioUpdateData.data;  // Already JSON string
            if (bioUpdateData.type === 'face') {
                currentUser.faceDescriptor = bioUpdateData.data;  // Already JSON string
            }
            localStorage.setItem('empSession', JSON.stringify(currentUser));
            
            alert('✅ تم تحديث البصمة بنجاح! سيتم إعادة تحميل الصفحة...');
            location.reload();
        } else {
            alert('❌ خطأ: ' + result.message);
        }
    } catch (e) {
        console.error(e);
        alert('❌ حدث خطأ في الاتصال');
    } finally {
        document.getElementById('loader').classList.add('hidden');
    }
}

// Cleanup resources when leaving the page to prevent memory leaks and battery drain
window.addEventListener('beforeunload', () => {
    if (faceDetectionInterval) clearInterval(faceDetectionInterval);
    if (timerInterval) clearInterval(timerInterval);
    if (geolocationWatchId !== null) navigator.geolocation.clearWatch(geolocationWatchId);
    
    // Stop biometric update video if active
    if (bioUpdateVideoStream) {
        bioUpdateVideoStream.getTracks().forEach(track => track.stop());
    }
});

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
    if (!currentUser || !currentUser.id) return;
    
    try {
        const res = await fetch(`${API_URL}?action=getNotifications&userId=${currentUser.id}&userRole=employee`);
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
        item.onclick = () => markNotificationAsRead(notif.id);
        
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
        'leave_approved': '✅',
        'leave_rejected': '❌',
        'site_approved': '📍',
        'site_rejected': '📍',
        'allowance_approved': '💰',
        'allowance_rejected': '💰',
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
    if (!currentUser || !currentUser.id) return;
    
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'markAllNotificationsAsRead', userId: currentUser.id }),
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
