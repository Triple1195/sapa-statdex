// helper.js - Pokémon Showdown Static Sprite Helpers & League Utilities

/**
 * Normalizes Pokémon species names for Pokémon Showdown sprite URLs.
 * Preserves hyphens for forms (e.g. landorus-therian, rotom-wash, kyurem-black)
 * while properly formatting Megas (e.g. charizard-mega-x -> charizard-megax).
 */
function formatShowdownSpriteName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();
    
    // Handle Mega evolutions to match Showdown's naming convention (e.g., "charizard-mega-x" -> "charizard-megax")
    clean = clean.replace(/-mega-([xy])/, 'mega$1');
    clean = clean.replace(/-primal-([a-z]+)/, 'primal$1');

    // Remove spaces, underscores, and special characters, but KEEP hyphens for standard form separators
    return clean.replace(/[^a-z0-9-]/g, '');
}

/**
 * Normalizes Pokémon species names for Autumnchi box sprites.
 */
function formatAutumnchiName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();
    clean = clean.replace(/[\s_]+/g, '-');
    return clean.replace(/[^a-z0-9-]/g, '');
}

/**
 * Generates sprite URLs.
 * @param {string} speciesName The raw species or form name.
 * @param {string} type 'gen5' for Showdown static sprite, 'color' for Autumnchi colored, 'monotone' for B&W.
 */
function getSpriteUrl(speciesName, type = 'color') {
    if (!speciesName) return 'https://play.pokemonshowdown.com/sprites/gen5/0.png';

    if (type === 'gen5') {
        const name = formatShowdownSpriteName(speciesName);
        return `https://play.pokemonshowdown.com/sprites/gen5/${name}.png`;
    } else if (type === 'monotone') {
        const name = formatAutumnchiName(speciesName);
        return `https://raw.githubusercontent.com/Autumnchi/monotone-box-sprites/main/${name}.png`;
    } else {
        const name = formatAutumnchiName(speciesName);
        return `https://raw.githubusercontent.com/Autumnchi/coloured-box-sprites/main/${name}.png`;
    }
}

/**
 * Prevents infinite reload loops if an image fails or is blocked by a network firewall.
 * Instantly swaps to a clean inline SVG question mark placeholder.
 */
function handleImageError(img) {
    // Nullify handler to prevent any possibility of infinite loops
    img.onerror = null; 
    
    // Clean inline SVG question mark icon data URI
    img.src = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpath d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'%3E%3C/path%3E%3Cline x1='12' y1='17' x2='12.01' y2='17'%3E%3C/line%3E%3C/svg%3E";
    img.style.objectFit = 'contain';
    img.style.opacity = '0.6';
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
