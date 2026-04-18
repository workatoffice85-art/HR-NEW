import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Standard Supabase client (used for public or system actions)
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Get a JWT-aware Supabase client to respect RLS
 * @param {string} token - The user's JWT token
 */
export function getAuthenticatedClient(token) {
    if (!token) return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    });
}

/**
 * Generate a secure UUID on the server
 */
export function generateUUID() {
    return crypto.randomUUID();
}

// --- Normalization Helpers ---
export function normalizeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

export function normalizeDigits(value) {
    return String(value)
        .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06F0));
}

export function normalizeEmailValue(value) {
    return normalizeString(value).toLowerCase();
}

export function normalizePhoneValue(value) {
    let phone = normalizeDigits(normalizeString(value));
    if (!phone) return '';
    phone = phone.replace(/[\u200f\u200e\s-]/g, '').replace(/[()]/g, '');
    if (phone.indexOf('00') === 0) phone = `+${phone.substring(2)}`;
    if (phone.indexOf('+') === 0) {
        phone = `+${phone.substring(1).replace(/[^\d]/g, '')}`;
    } else {
        phone = phone.replace(/[^\d]/g, '');
    }
    if (/^01\d{9}$/.test(phone)) phone = `+2${phone}`;
    else if (/^20\d{10}$/.test(phone)) phone = `+${phone}`;
    return phone;
}

// --- Security Helpers ---
export function hashPassword(password) {
    return bcrypt.hashSync(password, 10);
}

export function comparePassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

export function generateToken(user) {
    return jwt.sign(
        { id: user.id, role: user.role, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

export function verifyToken(token) {
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}
