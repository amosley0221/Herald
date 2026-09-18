/**
 * Cheap rule-based filtering, run before any LLM call.
 *
 * Per the spec this drops roughly 90% of a crawl for the price of some string
 * comparisons, so the scoring budget is spent on postings that could plausibly
 * clear the bar. Every rule is driven by the user's Preferences — there are no
 * built-in assumptions about what job anyone wants.
 */
export function prefilter(posting, preferences, options = { maxPostingAgeDays: 30 }) {
    const now = options.now ?? new Date();
    const postedAt = new Date(posting.postedAt);
    if (!Number.isFinite(postedAt.getTime()))
        return drop('unparseable posting date');
    const ageDays = (now.getTime() - postedAt.getTime()) / 86_400_000;
    if (ageDays > options.maxPostingAgeDays)
        return drop(`older than ${options.maxPostingAgeDays} days`);
    const title = posting.title.toLowerCase();
    const haystack = `${title} ${posting.company.toLowerCase()}`;
    for (const exclude of preferences.excludeKeywords) {
        if (!exclude.trim())
            continue;
        if (haystack.includes(exclude.toLowerCase().trim()))
            return drop(`excluded by keyword "${exclude}"`);
    }
    // An empty roles list means "show me everything" rather than "show me nothing".
    if (preferences.roles.length > 0 && !matchesAnyRole(title, preferences.roles)) {
        return drop('title matches none of the preferred roles');
    }
    if (preferences.seniority.length > 0 && !matchesAnySeniority(title, preferences.seniority)) {
        return drop('seniority does not match');
    }
    if (!matchesLocation(posting, preferences)) {
        return drop('location is neither remote nor in a preferred location');
    }
    // Only reject on salary when the posting actually published a range. A
    // missing range is not evidence of a low one, and scoring can still catch it.
    if (preferences.minSalary != null && posting.payMax != null && posting.payMax < preferences.minSalary) {
        return drop(`top of range (${posting.payMax}) is below the ${preferences.minSalary} floor`);
    }
    return { keep: true, reason: null };
}
function drop(reason) {
    return { keep: false, reason };
}
/**
 * A role preference matches when every word in it appears in the title. That
 * makes "Product Designer" match "Senior Product Designer, Growth" without also
 * matching "Product Manager".
 */
export function matchesAnyRole(title, roles) {
    return roles.some((role) => {
        const words = role.toLowerCase().split(/\s+/).filter(Boolean);
        return words.length > 0 && words.every((word) => title.includes(word));
    });
}
function matchesAnySeniority(title, seniority) {
    return seniority.some((level) => title.includes(level.toLowerCase().trim()));
}
function matchesLocation(posting, preferences) {
    if (posting.remote && preferences.remote)
        return true;
    // With no locations listed the user has expressed no geographic constraint.
    if (preferences.locations.length === 0)
        return true;
    const location = posting.location.toLowerCase();
    if (!location)
        return true; // unknown location; let scoring judge it
    return preferences.locations.some((preferred) => {
        const needle = preferred.toLowerCase().trim();
        if (!needle)
            return false;
        if (location.includes(needle))
            return true;
        // "Charlotte, NC" in preferences should match a posting that says just
        // "Charlotte" or just "NC".
        return needle.split(/[,\s]+/).filter((p) => p.length > 1).some((part) => location.includes(part));
    });
}
//# sourceMappingURL=prefilter.js.map