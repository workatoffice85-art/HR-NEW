/**
 * BiometricManager - Camera-based Face Recognition only
 * Supports: Camera Face Recognition using face-api.js
 * 
 * Logic:
 * 1. Check if camera is available
 * 2. Use face-api.js for face enrollment and authentication
 * 3. Simple and consistent across all devices
 */

class BiometricManager {
    constructor() {
        this.selectedBiometric = null;
    }

    // ============================================================
    // STEP 1: Check device capabilities - Camera only
    // ============================================================
    
    async checkAvailableBiometrics() {
        // Only camera-based face recognition
        const hasCamera = await this._checkCameraAvailability();
        
        if (hasCamera) {
            return [{
                type: 'face',
                name: 'بصمة الوجه (بالكاميرا)',
                icon: '📷',
                priority: 1,
                isHardware: false,
                deviceType: 'camera'
            }];
        }
        
        return [];
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

    // ============================================================
    // STEP 2: Enrollment (Register face)
    // ============================================================
    
    async enroll(biometricType, options = {}) {
        if (biometricType === 'face') {
            return await this._enrollFace(options.videoElement, options.modelUrl);
        }
        throw new Error('نوع البيومتريك غير مدعوم - فقط بصمة الوجه متاحة');
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

    // ============================================================
    // STEP 3: Authentication (Verify face)
    // ============================================================
    
    async authenticate(biometricData, options = {}) {
        let data = typeof biometricData === 'string' ? JSON.parse(biometricData) : biometricData;
        
        // Handle double-encoded data from old registrations
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                console.log('Parse failed:', e.message);
            }
        }
        
        // Handle new format: { type: 'face', data: [...] }
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data.type === 'face' && data.data) {
                let descriptorData = data.data;
                if (typeof descriptorData === 'string') {
                    descriptorData = JSON.parse(descriptorData);
                }
                data = descriptorData;
            }
        }
        
        // Always use face authentication
        return await this._authenticateFace(data, options.videoElement);
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
