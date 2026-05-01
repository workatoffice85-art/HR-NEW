/**
 * BiometricManager - Unified biometric authentication system
 * Supports: Hardware Biometrics (WebAuthn) + Camera Face Recognition (face-api.js)
 * 
 * Logic:
 * 1. Device has Fingerprint (hardware) → use Fingerprint (highest priority)
 * 2. Device has Face ID (hardware, iPhone/Android) → use Face ID
 * 3. No hardware biometric → fallback to Camera Face Recognition (face-api.js)
 * 4. One biometric per employee stored in database
 * 
 * This ensures the site is fast on modern devices with hardware biometrics,
 * while still working on older devices using camera-based face recognition.
 */

class BiometricManager {
    constructor() {
        this.availableBiometrics = [];
        this.selectedBiometric = null;
        this.credentialId = null;
    }

    // ============================================================
    // STEP 1: Check device capabilities
    // ============================================================
    
    async checkAvailableBiometrics() {
        this.availableBiometrics = [];
        
        // STEP 1: Check for hardware biometrics (WebAuthn) - FASTER & MORE SECURE
        const hasHardwareBiometric = await this._checkWebAuthnAvailability();
        
        if (hasHardwareBiometric) {
            // Device has hardware biometric sensor
            // We can't distinguish between Face ID vs Fingerprint from WebAuthn alone
            // But we offer both options and fingerprint gets higher priority
            
            this.availableBiometrics.push({
                type: 'fingerprint',
                name: 'بصمة الإصبع',
                icon: '👆',
                priority: 1, // Highest priority - default choice
                isHardware: true
            });
            
            this.availableBiometrics.push({
                type: 'face_hardware',
                name: 'Face ID',
                icon: '📱',
                priority: 2, // Second priority
                isHardware: true
            });
        }
        
        // STEP 2: Always offer camera-based face recognition as fallback
        // This works on ALL devices with a camera (laptops, old phones, etc.)
        const hasCamera = await this._checkCameraAvailability();
        if (hasCamera) {
            this.availableBiometrics.push({
                type: 'face',
                name: 'بصمة الوجه (بالكاميرا)',
                icon: '�',
                priority: hasHardwareBiometric ? 3 : 1, // Only default if no hardware
                isHardware: false
            });
        }
        
        // Sort by priority (lower number = higher priority)
        this.availableBiometrics.sort((a, b) => a.priority - b.priority);
        
        console.log('Available biometrics:', this.availableBiometrics);
        return this.availableBiometrics;
    }

    async _checkCameraAvailability() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                return false;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop()); // Release immediately
            return true;
        } catch (e) {
            console.log('Camera not available:', e.message);
            return false;
        }
    }

    async _checkWebAuthnAvailability() {
        try {
            // Check if WebAuthn is supported
            if (!window.PublicKeyCredential) {
                return false;
            }
            
            // Check if user verifying platform authenticator is available (fingerprint)
            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            return available;
        } catch (e) {
            console.log('WebAuthn not available:', e.message);
            return false;
        }
    }

    // ============================================================
    // STEP 2: Select biometric (auto or manual)
    // ============================================================
    
    selectBiometric(preferredType = null) {
        if (this.availableBiometrics.length === 0) {
            throw new Error('لا يوجد بيومتريك متاح على هذا الجهاز');
        }
        
        if (this.availableBiometrics.length === 1) {
            // Only one available, use it
            this.selectedBiometric = this.availableBiometrics[0];
        } else if (preferredType) {
            // User preference specified
            this.selectedBiometric = this.availableBiometrics.find(b => b.type === preferredType) 
                || this.availableBiometrics[0];
        } else {
            // Multiple available, use highest priority (fingerprint by default)
            this.selectedBiometric = this.availableBiometrics[0];
        }
        
        return this.selectedBiometric;
    }

    getBiometricSelectionUI() {
        if (this.availableBiometrics.length <= 1) {
            return null; // No need for selection UI
        }
        
        return {
            title: 'اختر طريقة البصمة',
            options: this.availableBiometrics.map(b => ({
                type: b.type,
                label: `${b.icon} ${b.name}`,
                recommended: b.priority === 1
            }))
        };
    }

    // ============================================================
    // STEP 3: Enrollment (Register new biometric)
    // ============================================================
    
    async enroll(biometricType, options = {}) {
        switch (biometricType) {
            case 'face':
                // Camera-based face recognition (face-api.js)
                return await this._enrollFace(options.videoElement, options.modelUrl);
            case 'fingerprint':
                // Hardware fingerprint via WebAuthn
                return await this._enrollHardwareBiometric('fingerprint', options.userId, options.userName);
            case 'face_hardware':
                // Hardware Face ID via WebAuthn (iPhone Face ID, Android Face Unlock)
                return await this._enrollHardwareBiometric('face_hardware', options.userId, options.userName);
            default:
                throw new Error('نوع البيومتريك غير مدعوم');
        }
    }

    async _enrollFace(videoElement, modelUrl = '../models') {
        if (!faceapi) {
            throw new Error('face-api.js not loaded');
        }
        
        // Ensure models are loaded
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
            faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl)
        ]);
        
        const detectOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
        const detection = await faceapi.detectSingleFace(videoElement, detectOptions)
            .withFaceLandmarks()
            .withFaceDescriptor();
        
        if (!detection) {
            throw new Error('لم يتم التعرف على وجه. دقق في الإضاءة.');
        }
        
        return {
            type: 'face',
            data: JSON.stringify(Array.from(detection.descriptor))
        };
    }

    async _enrollHardwareBiometric(bioType, userId, userName) {
        try {
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            
            const publicKeyCredentialCreationOptions = {
                challenge: challenge,
                rp: {
                    name: 'HR Attendance System',
                    id: window.location.hostname
                },
                user: {
                    id: new TextEncoder().encode(userId),
                    name: userId,
                    displayName: userName
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },   // ES256
                    { type: 'public-key', alg: -257 }  // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform', // Use device biometric (fingerprint/faceid)
                    userVerification: 'required',
                    residentKey: 'required'
                },
                timeout: 60000,
                attestation: 'none'
            };
            
            const credential = await navigator.credentials.create({
                publicKey: publicKeyCredentialCreationOptions
            });
            
            if (!credential) {
                throw new Error('لم يتم تسجيل البصمة');
            }
            
            // Store credential ID for later authentication
            this.credentialId = credential.id;
            
            // Convert rawId to base64 for storage
            const rawIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
            
            return {
                type: bioType, // 'fingerprint' or 'face_hardware'
                data: JSON.stringify({
                    credentialId: credential.id,
                    rawId: rawIdBase64,
                    type: credential.type
                })
            };
        } catch (e) {
            console.error('Hardware biometric enrollment error:', e);
            const typeName = bioType === 'fingerprint' ? 'بصمة الإصبع' : 'Face ID';
            throw new Error(`فشل في تسجيل ${typeName}: ` + e.message);
        }
    }

    // ============================================================
    // STEP 4: Authentication (Verify biometric)
    // ============================================================
    
    async authenticate(biometricData, options = {}) {
        const data = typeof biometricData === 'string' ? JSON.parse(biometricData) : biometricData;
        
        if (data.type === 'face' || (data.credentialId === undefined && Array.isArray(data))) {
            // Camera-based face recognition (face-api.js)
            return await this._authenticateFace(data, options.videoElement);
        } else if (data.type === 'fingerprint' || data.type === 'face_hardware' || data.credentialId) {
            // Hardware biometric via WebAuthn (fingerprint or Face ID)
            return await this._authenticateHardwareBiometric(data);
        }
        
        throw new Error('نوع بيانات البيومتريك غير معروف');
    }

    async _authenticateFace(storedDescriptor, videoElement) {
        if (!faceapi || !videoElement) {
            throw new Error('face-api.js not loaded or no video element');
        }
        
        const detectOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 1 });
        const detection = await faceapi.detectSingleFace(videoElement, detectOptions)
            .withFaceLandmarks()
            .withFaceDescriptor();
        
        if (!detection) {
            return { success: false, message: 'لم يتم التعرف على وجه' };
        }
        
        // Parse stored descriptor
        const storedArray = typeof storedDescriptor === 'string' 
            ? JSON.parse(storedDescriptor) 
            : storedDescriptor;
        
        const storedFloatArray = new Float32Array(storedArray);
        const currentFloatArray = detection.descriptor;
        
        // Calculate Euclidean distance
        let distance = 0;
        for (let i = 0; i < storedFloatArray.length; i++) {
            const diff = storedFloatArray[i] - currentFloatArray[i];
            distance += diff * diff;
        }
        distance = Math.sqrt(distance);
        
        // Threshold for match (lower is better match)
        const MATCH_THRESHOLD = 0.6;
        
        if (distance < MATCH_THRESHOLD) {
            return {
                success: true,
                message: 'تم التحقق بنجاح',
                confidence: 1 - (distance / MATCH_THRESHOLD)
            };
        } else {
            return {
                success: false,
                message: 'الوجه غير متطابق',
                distance: distance
            };
        }
    }

    async _authenticateHardwareBiometric(storedData) {
        try {
            const data = typeof storedData === 'string' ? JSON.parse(storedData) : storedData;
            
            // Decode rawId from base64
            const rawId = Uint8Array.from(atob(data.rawId), c => c.charCodeAt(0));
            
            const challenge = crypto.getRandomValues(new Uint8Array(32));
            
            const publicKeyCredentialRequestOptions = {
                challenge: challenge,
                allowCredentials: [{
                    type: 'public-key',
                    id: rawId,
                    transports: ['internal']
                }],
                userVerification: 'required',
                timeout: 60000
            };
            
            const assertion = await navigator.credentials.get({
                publicKey: publicKeyCredentialRequestOptions
            });
            
            if (!assertion) {
                return { success: false, message: 'فشل التحقق من البصمة' };
            }
            
            return {
                success: true,
                message: 'تم التحقق من البصمة بنجاح'
            };
        } catch (e) {
            console.error('Hardware biometric authentication error:', e);
            return {
                success: false,
                message: 'فشل التحقق: ' + e.message
            };
        }
    }

    // ============================================================
    // Helper: Load face-api models
    // ============================================================
    
    async loadFaceModels(modelUrl = '../models') {
        if (!faceapi) {
            throw new Error('face-api.js not loaded');
        }
        
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
            faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl)
        ]);
        
        return true;
    }
}

// Create global instance
window.biometricManager = new BiometricManager();
