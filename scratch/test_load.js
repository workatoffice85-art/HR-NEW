try {
    const handler = require('../api/exec.js');
    console.log("✅ Load successful! Handler is a:", typeof handler);
} catch (e) {
    console.error("❌ Load failed with error:", e);
}
