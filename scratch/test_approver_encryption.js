import crypto from 'crypto';

// Setup Mock Key for verification (simulating SUPABASE_SERVICE_ROLE_KEY)
const MOCK_KEY = "test-service-role-key-1234567890-very-secure-key";

/**
 * Generate a cryptographically signed HMAC token for email approvals
 */
function generateSecureToken(requestId, action, requestType, approverEmail = '', customExpiry = null) {
    const exp = customExpiry || (Date.now() + 48 * 60 * 60 * 1000); // Expires in 48 hours
    const payload = JSON.stringify({ requestId, action, requestType, approverEmail, exp });
    const signature = crypto
        .createHmac('sha256', MOCK_KEY)
        .update(payload)
        .digest('hex');
    
    // Package payload and signature in a URL-safe token
    const tokenObj = { payload, signature };
    return Buffer.from(JSON.stringify(tokenObj)).toString('base64url');
}

/**
 * Verify and decode a cryptographically signed HMAC token
 */
function verifySecureToken(tokenStr) {
    if (!tokenStr) return null;
    try {
        const decodedStr = Buffer.from(tokenStr, 'base64url').toString('utf8');
        const { payload, signature } = JSON.parse(decodedStr);
        
        // Re-generate signature
        const expectedSignature = crypto
            .createHmac('sha256', MOCK_KEY)
            .update(payload)
            .digest('hex');
        
        if (signature !== expectedSignature) {
            console.error("❌ Token verification failed: signature mismatch");
            return null;
        }
        
        const data = JSON.parse(payload);
        if (Date.now() > data.exp) {
            console.error("❌ Token verification failed: token expired");
            return null;
        }
        
        return data; // { requestId, action, requestType, approverEmail, exp }
    } catch (e) {
        console.error("❌ Token verification failed: error decoding token", e);
        return null;
    }
}

// ============================================
// TEST SUITE EXECUTION
// ============================================
console.log("🏁 STARTING OUTLOOK APPROVER CRYPTOGRAPHIC TESTS...\n");

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    if (condition) {
        passedTests++;
        console.log(`✅ PASS: ${message}`);
    } else {
        failedTests++;
        console.error(`❌ FAIL: ${message}`);
    }
}

// Test 1: Generate & Verify Token with Approver Email
try {
    const managerEmail = "manager.cairo@company.com";
    const token = generateSecureToken("REQ98765", "approved", "leave", managerEmail);
    console.log(`Generated Token: ${token}`);
    
    const verified = verifySecureToken(token);
    assert(verified !== null, "Token with approverEmail should be successfully verified");
    assert(verified.requestId === "REQ98765", "Request ID should match REQ98765");
    assert(verified.action === "approved", "Action should match 'approved'");
    assert(verified.requestType === "leave", "Request type should match 'leave'");
    assert(verified.approverEmail === managerEmail, `approverEmail should match '${managerEmail}'`);
} catch (e) {
    failedTests++;
    console.error("Exception in Test 1:", e);
}

console.log("\n---------------------------------------------\n");

// Test 2: Forged Token Email Hijacking Attempt
try {
    const managerEmail = "manager.cairo@company.com";
    const token = generateSecureToken("REQ98765", "approved", "leave", managerEmail);
    
    // Manually decode and alter the payload, keeping original signature
    const decodedStr = Buffer.from(token, 'base64url').toString('utf8');
    const tokenObj = JSON.parse(decodedStr);
    
    const originalPayload = JSON.parse(tokenObj.payload);
    // Maliciously change the approverEmail to trick the server into thinking someone else approved it
    originalPayload.approverEmail = "attacker.hacker@gmail.com"; 
    
    const forgedTokenObj = {
        payload: JSON.stringify(originalPayload),
        signature: tokenObj.signature // Keep original signature
    };
    const forgedToken = Buffer.from(JSON.stringify(forgedTokenObj)).toString('base64url');
    
    const verified = verifySecureToken(forgedToken);
    assert(verified === null, "Forged signature token must fail verification and prevent email spoofing!");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 2:", e);
}

console.log("\n---------------------------------------------\n");

// Test 3: Default Parameter (No Email Provided)
try {
    const token = generateSecureToken("REQ12345", "rejected", "device");
    const verified = verifySecureToken(token);
    assert(verified !== null, "Token without email should verify successfully");
    assert(verified.approverEmail === "", "approverEmail should default to empty string");
    assert(verified.requestId === "REQ12345", "Request ID should match REQ12345");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 3:", e);
}

console.log("\n---------------------------------------------\n");

// Test 4: Expired Token with Email
try {
    const managerEmail = "manager.cairo@company.com";
    const expiredTime = Date.now() - 5000; // Expired 5 seconds ago
    const token = generateSecureToken("REQ44444", "approved", "allowance", managerEmail, expiredTime);
    
    const verified = verifySecureToken(token);
    assert(verified === null, "Expired token must fail verification even if email matches");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 4:", e);
}

console.log(`\n🎉 TEST RESULTS SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
if (failedTests > 0) {
    process.exit(1);
} else {
    console.log("🚀 All Outlook Approver Cryptographic verification tests passed successfully!");
}
