/**
 * Phase 3: Resilience & UX Polish Utilities
 */

/**
 * Show a modern toast notification
 * @param {string} message - The message to display
 * @param {'success'|'error'|'info'} type - Type of notification
 * @param {number} duration - How long to show in ms (default 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '🔔';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    msgSpan.style.marginLeft = '10px';
    
    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
    
    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
            if (container.childNodes.length === 0) container.remove();
        }, 400);
    }, duration);
}

/**
 * Set button loading state
 * @param {string|HTMLElement} target - Button ID or Element
 * @param {boolean} isLoading - Loading state
 */
function setLoading(target, isLoading) {
    const btn = typeof target === 'string' ? document.getElementById(target) : target;
    if (!btn) return;

    if (isLoading) {
        btn.classList.add('btn-loading');
        btn.setAttribute('disabled', 'true');
    } else {
        btn.classList.remove('btn-loading');
        btn.removeAttribute('disabled');
    }
}

/**
 * Centralized confirmation wrapper
 * @param {string} message 
 * @param {string} title
 * @returns {Promise<boolean>}
 */
async function showConfirm(message, title = 'هل أنت متأكد؟') {
    const modal = document.getElementById('confirmModal');
    if (!modal) return confirm(message);

    return new Promise((resolve) => {
        const titleEl = document.getElementById('confirmTitle');
        const msgEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYesBtn');
        const noBtn = document.getElementById('confirmNoBtn');

        if (titleEl) titleEl.innerText = title;
        if (msgEl) msgEl.innerText = message;

        const cleanup = (result) => {
            modal.classList.add('hidden');
            // Remove listeners to prevent memory leaks or duplicate triggers
            yesBtn.onclick = null;
            noBtn.onclick = null;
            resolve(result);
        };

        yesBtn.onclick = () => cleanup(true);
        noBtn.onclick = () => cleanup(false);

        modal.classList.remove('hidden');
    });
}

/**
 * Safely create a table row with text content
 * @param {Array<string|HTMLElement>} cells - Array of cell contents
 * @returns {HTMLTableRowElement}
 */
function createSafeRow(cells) {
    const tr = document.createElement('tr');
    cells.forEach(cell => {
        const td = document.createElement('td');
        if (cell instanceof HTMLElement) {
            td.appendChild(cell);
        } else {
            td.textContent = cell;
        }
        tr.appendChild(td);
    });
    return tr;
}

// Maps standard alert to Toast system in these portals
window.alert = (msg) => showToast(msg, 'info');

// Handle fetch errors globally
const originalFetch = window.fetch;
window.fetch = async (...args) => {
    try {
        const response = await originalFetch(...args);
        return response;
    } catch (error) {
        console.error('Fetch Error:', error);
        showToast('خطأ في الاتصال بالشبكة. تحقق من الإنترنت.', 'error');
        throw error;
    }
};
