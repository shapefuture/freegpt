const { v4: uuidv4 } = require('uuid');

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LOG_LEVEL = process.env.DEBUG_MODE === 'true' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

function log(level, message, ...args) {
    if (LOG_LEVELS[level.toUpperCase()] >= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}]`, message, ...args);
    }
}

function verboseEntry(functionName, args) {
    log('DEBUG', `Entering ${functionName} with args:`, args);
}
function verboseExit(functionName, result) {
    log('DEBUG', `Exiting ${functionName} with result:`, result);
}

function generateUUID() {
    verboseEntry('generateUUID', {});
    const uuid = uuidv4();
    verboseExit('generateUUID', uuid);
    return uuid;
}

module.exports = { log, generateUUID, verboseEntry, verboseExit };