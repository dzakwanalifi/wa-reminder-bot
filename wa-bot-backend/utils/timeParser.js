const chrono = require('chrono-node');

/**
 * Parse natural language time strings into ISO 8601 UTC format
 * @param {string} timeString - The time string to parse
 * @param {Date} referenceDate - Reference date for relative time parsing (default: now)
 * @returns {string|null} ISO 8601 string in UTC or null if parsing fails
 */
function parseNaturalLanguageTime(timeString, referenceDate = new Date()) {
    if (!timeString) return null;
    console.log(`Attempting to parse time string with Chrono: "${timeString}"`);
    try {
        // Parse relative to referenceDate with forwardDate to interpret future dates
        const parsedResults = chrono.parse(timeString, referenceDate, { forwardDate: true });

        // Get most likely result (first)
        if (parsedResults && parsedResults.length > 0) {
            const parsedDate = parsedResults[0].start.date();
            console.log(`Chrono parsed "${timeString}" to: ${parsedDate.toISOString()}`);
            return parsedDate.toISOString(); // Return in ISO 8601 UTC format
        } else {
            console.warn(`Chrono could not parse time string: "${timeString}"`);
            return null;
        }
    } catch (error) {
        console.error(`Error parsing time string "${timeString}" with Chrono:`, error);
        return null;
    }
}

module.exports = {
    parseNaturalLanguageTime
};