// helper.js - Centralized Frontend Helper & Utility Functions

/**
 * Normalizes Pokémon species names for Autumnchi GitHub box sprites.
 */
function formatAutumnchiSpriteName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();
    clean = clean.replace(/[\s_]+/g, '-');
    return clean.replace(/[^a-z0-9-]/g, '');
}

/**
 * Generates sprite URLs hosted on GitHub (bypasses corporate firewall blocks).
 * @param {string|number} pokemonIdentifier Dex ID (for PokeAPI) or Species Name (for Autumnchi).
 * @param {string} type 'gen5' for PokeAPI B/W Animated GIF, 'color' for Autumnchi colored, 'monotone' for B&W.
 * @returns {string} The full image URL.
 */
function getSpriteUrl(pokemonIdentifier, type = 'color') {
    if (!pokemonIdentifier) return 'https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/0.png';

    if (type === 'gen5') {
        // PokéAPI Black & White Animated GIFs via GitHub (bypasses corporate SSL blocks)
        const dexId = Number(pokemonIdentifier) || 0;
        if (dexId > 0) {
            return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${dexId}.gif`;
        }
        // Fallback static sprite if dex ID is missing/0
        return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexId || 0}.png`;

    } else if (type === 'monotone') {
        // Autumnchi Monotone Box Sprites for Fainted Pokémon
        const formattedName = formatAutumnchiSpriteName(pokemonIdentifier);
        return `https://raw.githubusercontent.com/Autumnchi/monotone-box-sprites/main/${formattedName}.png`;

    } else {
        // Autumnchi Colored Box Sprites for Survived Pokémon
        const formattedName = formatAutumnchiSpriteName(pokemonIdentifier);
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
