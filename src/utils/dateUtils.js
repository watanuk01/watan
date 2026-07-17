/**
 * Date Utilities for London (UK) Business Timezone
 */

/**
 * Create a Date object representing the given date/time in the Europe/London timezone.
 * Uses Intl.DateTimeFormat to compute the timezone offset dynamically and accurately
 * without parsing locale strings.
 */
export const createLondonDate = (year, month, day, h = 0, m = 0, s = 0, ms = 0) => {
    // targetUtc is the UTC timestamp assuming the numbers are UTC
    const targetUtc = Date.UTC(year, month, day, h, m, s);
    const guessDate = new Date(targetUtc);
    
    // Format guessDate in Europe/London timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(guessDate);
    const getPart = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    
    const guessLondonUtc = Date.UTC(
        getPart('year'),
        getPart('month') - 1,
        getPart('day'),
        getPart('hour'),
        getPart('minute'),
        getPart('second')
    );
    
    const offset = guessLondonUtc - targetUtc;
    return new Date(targetUtc - offset + ms);
};

/**
 * Parse any date representation (Date, Timestamp, or string) safely.
 */
export const parseDateSafe = (d) => {
    if (!d) return null;
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    if (typeof d.toDate === 'function') return d.toDate();
    if (d.seconds) return new Date(d.seconds * 1000);
    if (typeof d === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            const [y, m, day] = d.split('-').map(Number);
            return createLondonDate(y, m - 1, day, 0, 0, 0, 0);
        }
        const parsed = new Date(d);
        return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};
