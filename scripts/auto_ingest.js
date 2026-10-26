import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function loadAliases() {
  const aliases = {};
  try {
    const csvPath = path.join(process.cwd(), "scripts", "showdown_aliases.csv");
    if (fs.existsSync(csvPath)) {
      const content = fs.readFileSync(csvPath, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(",");
        if (parts.length >= 2) {
          const leagueName = parts[0].trim().replace(/^["']|["']$/g, '');
          const sdName = parts[1].trim().replace(/^["']|["']$/g, '');
          if (leagueName && sdName && leagueName.toLowerCase() !== "league_name") {
            aliases[leagueName] = sdName;
          }
        }
      }
    }
  } catch (e) {
    console.log("Could not read showdown_aliases.csv, falling back to direct names.");
  }
  return aliases;
}

const showdownAliases = loadAliases();

function getShowdownName(leagueName) {
  return showdownAliases[leagueName] || leagueName.trim();
}

// Detailed Replay Log Parser Engine (ReplayAnalyzerV8)
function parseReplayStats(logText) {
  const lines = logText.split("\n");
  const playerMap = {}; // "p1" -> username, "p2" -> username
  const teams = { p1: {}, p2: {} }; // pokemon species -> { kills, deaths, team_ko, survived }
  let lastAttacker = null;

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 2) continue;

    const cmd = parts[1];

    // Identify players
    if (cmd === "player") {
      const pId = parts[2]; // p1 or p2
      const pName = parts[3];
      if (pId && pName) playerMap[pId] = pName;
    }

    // Register team members from |poke| lines
    if (cmd === "poke") {
      const pId = parts[2]; // p1 or p2
      const species = parts[3].split(",")[0].trim();
      if (pId && species) {
        teams[pId][species] = { kills: 0, deaths: 0, team_ko: 0, survived: 1 };
      }
    }

    // Track move usage/attacker
    if (cmd === "move" || cmd === "cant") {
      const sideMon = parts[2]; // e.g. "p1a: Landorus-Therian"
      if (sideMon) {
        const pId = sideMon.substring(0, 2);
        const species = sideMon.split(":")[1]?.trim();
        if (pId && species) lastAttacker = { pId, species };
      }
    }

    // Process Knockouts
    if (cmd === "faint") {
      const sideMon = parts[2]; // e.g. "p2a: Heatran"
      if (sideMon) {
        const faintedPId = sideMon.substring(0, 2);
        const faintedSpecies = sideMon.split(":")[1]?.trim();

        if (faintedPId && faintedSpecies && teams[faintedPId][faintedSpecies]) {
          // Mark as fainted / not survived
          teams[faintedPId][faintedSpecies].deaths = 1;
          teams[faintedPId][faintedSpecies].survived = 0;

          // Credit KO
          if (lastAttacker) {
            if (lastAttacker.pId !== faintedPId) {
              // Enemy KO
              if (teams[lastAttacker.pId]?.[lastAttacker.species]) {
                teams[lastAttacker.pId][lastAttacker.species].kills += 1;
              }
            } else {
              // Team KO (self / teammate knockout via recoil, self-destruct, etc.)
              if (teams[lastAttacker.pId]?.[lastAttacker.species]) {
                teams[lastAttacker.pId][lastAttacker.species].team_ko += 1;
              }
            }
          }
        }
      }
    }
  }

  return { playerMap, teams };
}

async function runWeeklyIngest() {
  console.log("Starting automated historical & weekly replay fetch...");

  const seasonRes = await db.execute("SELECT * FROM seasons ORDER BY season DESC LIMIT 1");
  if (seasonRes.rows.length === 0) {
    console.log("No active seasons found in database.");
    return;
  }
  
  const activeSeason = seasonRes.rows[0];
  const seasonNum = activeSeason.season;
  const format = activeSeason.format || "";
  const startDateStr = activeSeason.week_one_start_date;
  const startDate = new Date(startDateStr);
  
  const now = new Date();
  const diffDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);

  console.log(`Active Season: ${seasonNum} | Format: ${format || 'None'} | Scanning Weeks 1 to ${currentWeek}`);

  for (let w = 1; w <= currentWeek; w++) {
    console.log(`\n--- Processing Season ${seasonNum}, Week ${w} ---`);

    const matchesRes = await db.execute({
      sql: "SELECT * FROM matches WHERE season = ? AND week = ?",
      args: [seasonNum, w]
    });

    if (matchesRes.rows.length === 0) {
      console.log(`No matches scheduled for Week ${w}.`);
      continue;
    }

    const weekStartTime = Math.floor((startDate.getTime() + (w - 1) * 7 * 86400000) / 1000);
    const weekEndTime = Math.floor((startDate.getTime() + w * 7 * 86400000) / 1000);

    for (const match of matchesRes.rows) {
      const { match_id, player_1, player_2 } = match;
      
      const sdPlayer1 = getShowdownName(player_1);
      const sdPlayer2 = getShowdownName(player_2);

      console.log(`Checking match: ${player_1} (${sdPlayer1}) vs ${player_2} (${sdPlayer2})`);

      let searchUrl = `https://replay.pokemonshowdown.com/search.json?user=${encodeURIComponent(sdPlayer1)}&user2=${encodeURIComponent(sdPlayer2)}`;
      if (format) {
        searchUrl += `&format=${encodeURIComponent(format)}`;
      }
      
      try {
        const response = await fetch(searchUrl);
        const json = await response.json();

        if (!json || json.length === 0) {
          console.log(` -> No replays found.`);
          continue;
        }

        const filteredJson = json.filter(battle => {
          const t = Number(battle.uploadtime);
          return t > weekStartTime && t <= weekEndTime;
        });
        filteredJson.sort((a, b) => Number(a.uploadtime) - Number(b.uploadtime));

        console.log(` -> Found ${filteredJson.length} valid game(s) for Week ${w}.`);

        for (let i = 0; i < Math.min(filteredJson.length, 3); i++) {
          const battleId = filteredJson[i].id;
          const gameNumber = i + 1;
          const gameId = `${match_id}_g${gameNumber}`;
          const replayUrl = `https://replay.pokemonshowdown.com/${battleId}`;

          const existingGame = await db.execute({
            sql: "SELECT game_id FROM match_games WHERE game_id = ?",
            args: [gameId]
          });

          if (existingGame.rows.length > 0) {
            console.log(`    [Game ${gameNumber}] Already ingested (${gameId}). Skipping.`);
            continue;
          }

          console.log(`    [Game ${gameNumber}] Ingesting ${battleId}...`);
          const logRes = await fetch(`${replayUrl}.json`);
          const logData = await logRes.json();

          const logText = logData.log || "";
          const players = logData.players || [sdPlayer1, sdPlayer2];
          let winner = "";
          let turns = 0;

          const lines = logText.split("\n");
          for (const line of lines) {
            if (line.startsWith("|win|")) {
              winner = line.split("|")[2];
            } else if (line.startsWith("|turn|")) {
              turns = parseInt(line.split("|")[2], 10);
            }
          }

          const loser = (winner.toLowerCase() === players[0].toLowerCase()) ? players[1] : players[0];

          // 1. Insert Game Summary
          await db.execute({
            sql: `INSERT OR REPLACE INTO match_games (game_id, match_id, game_number, replay_url, winner, loser, turns) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [gameId, match_id, gameNumber, replayUrl, winner, loser, turns]
          });

          // 2. Parse Detailed Pokémon Stats
          const { playerMap, teams } = parseReplayStats(logText);

          for (const pId of ["p1", "p2"]) {
            const playerName = playerMap[pId] || (pId === "p1" ? sdPlayer1 : sdPlayer2);
            const monList = teams[pId];

            for (const [species, stats] of Object.entries(monList)) {
              const statId = `${gameId}_${playerName}_${species}`.replace(/\s+/g, "_");
              await db.execute({
                sql: `INSERT OR REPLACE INTO match_pokemon_stats (stat_id, game_id, player, pokemon, kills, deaths, team_ko, survived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [statId, gameId, playerName, species, stats.kills, stats.deaths, stats.team_ko, stats.survived]
              });
            }
          }

          console.log(`    [Game ${gameNumber}] Detailed stats successfully written to match_pokemon_stats!`);
        }

      } catch (e) {
        console.error(`Error processing match ${match_id}:`, e.message);
      }
    }
  }
  console.log("\n✅ Ingestion run complete across all active weeks!");
}

runWeeklyIngest();
