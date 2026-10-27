// helper.js - Centralized Frontend Helper & Utility Functions

/**
 * Generates the correct Autumnchi GitHub sprite URL for a Pokémon.
 * @param {string} speciesName The species or form name.
 * @param {boolean} isMonotone Whether to use the monotone (black & white) repository.
 * @returns {string} The full image URL.
 */
function getSpriteUrl(speciesName, isMonotone = false) {
    if (!speciesName) return '';
    let clean = speciesName.toLowerCase().trim()
        .replace(/[^a-z0-9-]/g, '');
    
    const baseUrl = isMonotone 
        ? "https://raw.githubusercontent.com/Autumnchi/monotone-box-sprites/main/" 
        : "https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/";
        
    return `${baseUrl}${clean}.png`;
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
