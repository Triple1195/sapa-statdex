import { createClient } from "@libsql/client";

// Connect to your Turso database using your environment variables
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function seedDex() {
  console.log("Creating pokemon_dex table if it doesn't exist...");
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pokemon_dex (
        pokemon_name TEXT PRIMARY KEY,
        dex_id INTEGER NOT NULL
    );
  `);

  console.log("Fetching Pokémon list from PokéAPI...");
  // Fetch up to 1025 Pokémon (covers Gen 1 through Gen 9)
  const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1025");
  const data = await response.json();

  const batchStatements = [];

  for (const item of data.results) {
    const name = item.name; // e.g., "tapu-koko", "charizard", "kommo-o"
    // Extract the ID from the URL (e.g., "https://pokeapi.co/api/v2/pokemon/785/" -> 785)
    const idMatch = item.url.match(/\/pokemon\/(\d+)\//);
    if (!idMatch) continue;
    const dexId = Number(idMatch[1]);

    batchStatements.push({
      sql: "INSERT OR REPLACE INTO pokemon_dex (pokemon_name, dex_id) VALUES (?, ?)",
      args: [name, dexId]
    });
  }

  // Add common form variants manually if needed (e.g., Megas)
  const manualVariants = [
    { name: "charizard-mega-x", id: 6 },
    { name: "charizard-mega-y", id: 6 },
    { name: "mewtwo-mega-x", id: 150 },
    { name: "mewtwo-mega-y", id: 150 }
  ];

  for (const variant of manualVariants) {
    batchStatements.push({
      sql: "INSERT OR REPLACE INTO pokemon_dex (pokemon_name, dex_id) VALUES (?, ?)",
      args: [variant.name, variant.id]
    });
  }

  console.log(`Inserting ${batchStatements.length} records into Turso...`);
  await db.batch(batchStatements);
  console.log("✅ Successfully populated pokemon_dex table!");
}

seedDex().catch(err => {
  console.error("Error seeding dex table:", err);
});
