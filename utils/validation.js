/**
 * Validation utility for LeaseHub
 */

/**
 * Validates a password against strong security rules.
 * Rules:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 * - At least 1 special character
 * 
 * @param {string} password - The password to validate
 * @returns {object} { isValid: boolean, message: string }
 */
function validatePassword(password) {
    if (!password) {
        return { isValid: false, message: 'Password is required' };
    }
    
    if (password.length < 8) {
        return { isValid: false, message: 'Password must be at least 8 characters long' };
    }
    
    if (!/[A-Z]/.test(password)) {
        return { isValid: false, message: 'Password must contain at least one uppercase letter' };
    }
    
    if (!/[a-z]/.test(password)) {
        return { isValid: false, message: 'Password must contain at least one lowercase letter' };
    }
    
    if (!/[0-9]/.test(password)) {
        return { isValid: false, message: 'Password must contain at least one number' };
    }
    
    // Special characters include standard symbols
    if (!/[!@#$%^&*(),.?":{}|<>\-_]/.test(password)) {
        return { isValid: false, message: 'Password must contain at least one special character' };
    }
    
    return { isValid: true, message: 'Password is valid' };
}

module.exports = {
    validatePassword
};
