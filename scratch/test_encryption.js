import crypto from 'crypto';

// Setup Mock Key for verification
const MOCK_KEY = "test-service-role-key-1234567890-very-secure-key";

/**
 * Generate a cryptographically signed HMAC token for email approvals
 */
function generateSecureToken(requestId, action, requestType, customExpiry = null) {
    const exp = customExpiry || (Date.now() + 48 * 60 * 60 * 1000); // Expires in 48 hours
    const payload = JSON.stringify({ requestId, action, requestType, exp });
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
        
        return data; // { requestId, action, requestType, exp }
    } catch (e) {
        console.error("❌ Token verification failed: error decoding token", e);
        return null;
    }
}

// ============================================
// TEST SUITE EXECUTION
// ============================================
console.log("🏁 STARTING CRYPTOGRAPHIC TOKEN VERIFICATION TESTS...\n");

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

// Test 1: Generate & Verify Valid Token
try {
    const token = generateSecureToken("REQ98765", "approved", "leave");
    console.log(`Generated Token: ${token}`);
    
    const verified = verifySecureToken(token);
    assert(verified !== null, "Token should be successfully verified");
    assert(verified.requestId === "REQ98765", "Request ID should match");
    assert(verified.action === "approved", "Action should match");
    assert(verified.requestType === "leave", "Request type should match");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 1:", e);
}

console.log("\n---------------------------------------------\n");

// Test 2: Forged Token Signature
try {
    const token = generateSecureToken("REQ98765", "approved", "leave");
    
    // Manually decode and alter the payload, keeping signature
    const decodedStr = Buffer.from(token, 'base64url').toString('utf8');
    const tokenObj = JSON.parse(decodedStr);
    
    // Alter action to 'approved' but inside the payload we change request ID or action to hijack
    const originalPayload = JSON.parse(tokenObj.payload);
    originalPayload.action = "rejected"; // Malicious edit
    
    const forgedTokenObj = {
        payload: JSON.stringify(originalPayload),
        signature: tokenObj.signature // Keep original signature
    };
    const forgedToken = Buffer.from(JSON.stringify(forgedTokenObj)).toString('base64url');
    
    const verified = verifySecureToken(forgedToken);
    assert(verified === null, "Forged signature token must fail verification");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 2:", e);
}

console.log("\n---------------------------------------------\n");

// Test 3: Expired Token
try {
    // Generate token with an expiry in the past
    const expiredTime = Date.now() - 1000; // Expired 1 second ago
    const token = generateSecureToken("REQ11111", "approved", "site", expiredTime);
    
    const verified = verifySecureToken(token);
    assert(verified === null, "Expired token must fail verification");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 3:", e);
}

console.log("\n---------------------------------------------\n");

// Test 4: Badly Formatted Token
try {
    const verified = verifySecureToken("this-is-not-a-valid-base64-json-token");
    assert(verified === null, "Corrupt token must fail gracefully");
} catch (e) {
    failedTests++;
    console.error("Exception in Test 4:", e);
}

console.log(`\n🎉 TEST RESULTS SUMMARY: ${passedTests} passed, ${failedTests} failed.`);
if (failedTests > 0) {
    process.exit(1);
} else {
    console.log("🚀 All token cryptographic tests passed successfully!");
}
