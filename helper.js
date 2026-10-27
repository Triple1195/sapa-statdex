// helper.js - Centralized Frontend Helper & Utility Functions

/**
 * Normalizes Pokémon species names for Showdown Gen 5 sprites.
 */
function formatShowdownSpriteName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();

    // Handle Mega forms for Showdown (e.g., charizard-mega-x -> charizard-megax)
    if (clean.includes('-mega-')) {
        clean = clean.replace('-mega-', '-mega');
    }

    // Remove special characters except hyphens
    return clean.replace(/[^a-z0-9-]/g, '');
}

/**
 * Normalizes Pokémon species names for Autumnchi GitHub box sprites.
 * Converts spaces to hyphens (e.g., "tapu koko" -> "tapu-koko").
 */
function formatGithubSpriteName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();

    // Convert spaces to hyphens (e.g., "tapu koko" -> "tapu-koko")
    clean = clean.replace(/\s+/g, '-');

    // Remove special characters while preserving hyphens
    return clean.replace(/[^a-z0-9-]/g, '');
}

/**
 * Generates the correct sprite URL based on requested sprite set.
 * @param {string} speciesName The species or form name.
 * @param {string} type 'gen5' for Showdown, 'color' for Autumnchi colored, 'monotone' for B&W.
 * @returns {string} The full image URL.
 */
function getSpriteUrl(speciesName, type = 'color') {
    if (!speciesName) return 'https://play.pokemonshowdown.com/sprites/dex/0.png';
    
    if (type === 'gen5') {
        const formattedName = formatShowdownSpriteName(speciesName);
        return `https://play.pokemonshowdown.com/sprites/gen5/${formattedName}.png`;
    } else if (type === 'monotone') {
        const formattedName = formatGithubSpriteName(speciesName);
        return `https://raw.githubusercontent.com/Autumnchi/monotone-box-sprites/main/${formattedName}.png`;
    } else {
        const formattedName = formatGithubSpriteName(speciesName);
        return `https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/${formattedName}.png`;
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
