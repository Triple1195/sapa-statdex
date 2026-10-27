// helper.js - Centralized Frontend Helper & Utility Functions

/**
 * Generates the correct sprite URL based on type (Showdown Gen 5 vs Autumnchi GitHub).
 * @param {string} speciesName The species or form name.
 * @param {string} type 'gen5' for Showdown animated/static sprites, 'color' for Autumnchi colored, 'monotone' for B&W.
 * @returns {string} The full image URL.
 */
function getSpriteUrl(speciesName, type = 'color') {
    if (!speciesName) return 'https://play.pokemonshowdown.com/sprites/dex/0.png';
    let clean = speciesName.toLowerCase().trim()
        .replace(/[^a-z0-9-]/g, '');
    
    if (type === 'gen5') {
        return `https://play.pokemonshowdown.com/sprites/gen5/${clean}.png`;
    } else if (type === 'monotone') {
        return `https://raw.githubusercontent.com/Autumnchi/monotone-box-sprites/main/${clean}.png`;
    } else {
        // Default to colored box sprites
        return `https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/${clean}.png`;
    }
}

/**
 * Maps a backend Showdown tag to its clean front-facing league display name.
 */
function getDisplayName(name) {
    if (!name) return '';
    const clean = name.trim().toLowerCase();
    return window.playerAliasesMap && window.playerAliasesMap[clean] ? window.playerAliasesMap[clean] : name;
}

/**
 * Maps a display name back to its corresponding Showdown tag.
 */
function getShowdownTag(displayName) {
    if (!displayName) return '';
    const clean = displayName.trim().toLowerCase();
    return window.displayToTagMap && window.displayToTagMap[clean] ? window.displayToTagMap[clean] : displayName;
}
