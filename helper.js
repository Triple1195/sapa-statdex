// helper.js - Centralized Static Sprite & Utility Helpers

/**
 * Normalizes Pokémon species names for Showdown's static dex sprites on GitHub.
 * Examples:
 *   "Tapu Koko"        -> "tapukoko"
 *   "Landorus-Therian" -> "landorustherian"
 *   "Gastrodon-East"   -> "gastrodoneast"
 *   "Zygarde-10%"      -> "zygarde10"
 */
function formatShowdownName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();
    return clean.replace(/[^a-z0-9]/g, '');
}

/**
 * Normalizes Pokémon species names for Autumnchi box sprites on GitHub.
 * Examples:
 *   "Tapu Koko"        -> "tapu-koko"
 *   "Landorus-Therian" -> "landorus-therian"
 */
function formatAutumnchiName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();
    clean = clean.replace(/[\s_]+/g, '-');
    return clean.replace(/[^a-z0-9-]/g, '');
}

/**
 * Generates static sprite URLs hosted on GitHub (bypasses corporate SSL/firewall blocks).
 * @param {string} speciesName The raw species or form name from your battle stats.
 * @param {string} type 'dex' for Showdown static front sprite, 'color' for Autumnchi colored, 'monotone' for Autumnchi B&W.
 * @returns {string} The image URL.
 */
function getSpriteUrl(speciesName, type = 'color') {
    if (!speciesName) return 'https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/0.png';

    if (type === 'dex') {
        // Static Showdown Front Sprite via GitHub Raw
        const name = formatShowdownName(speciesName);
        return `https://raw.githubusercontent.com/smogon/pokemon-showdown-client/master/sprites/dex/${name}.png`;

    } else if (type === 'monotone') {
        // Autumnchi Monotone Box Sprite for Fainted Pokémon
        const name = formatAutumnchiName(speciesName);
        return `https://raw.githubusercontent.com/Autumnchi/monotone-box-sprites/main/${name}.png`;

    } else {
        // Autumnchi Colored Box Sprite for Survived Pokémon
        const name = formatAutumnchiName(speciesName);
        return `https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/${name}.png`;
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
