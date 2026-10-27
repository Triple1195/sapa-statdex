/**
 * Normalizes Pokémon species names for Pokémon Showdown sprite URLs.
 * Preserves necessary form hyphens while fixing compound names like kommo-o -> kommoo.
 */
function formatShowdownSpriteName(speciesName) {
    if (!speciesName) return '0';
    let clean = speciesName.toLowerCase().trim();
    
    // Fix specific species with hyphens that are NOT alternate forms (e.g., kommo-o, hakamo-o, jangmo-o, porygon-z)
    const baseNameExceptions = {
        'kommo-o': 'kommoo',
        'hakamo-o': 'hakamoo',
        'jangmo-o': 'jangmoo',
        'porygon-z': 'porygonz',
        'ho-oh': 'hooh',
        'wo-chien': 'wochien',
        'chien-pao': 'chienpao',
        'ting-lu': 'tinglu',
        'chi-yu': 'chiyu'
    };

    if (baseNameExceptions[clean]) {
        return baseNameExceptions[clean];
    }

    // Handle Mega evolutions to match Showdown's naming convention (e.g., "charizard-mega-x" -> "charizard-megax")
    clean = clean.replace(/-mega-([xy])/, 'mega$1');
    clean = clean.replace(/-primal-([a-z]+)/, 'primal$1');

    // Remove spaces, underscores, and special characters, keeping hyphens for true forms
    return clean.replace(/[^a-z0-9-]/g, '');
}
