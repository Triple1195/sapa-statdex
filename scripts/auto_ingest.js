import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Load showdown aliases from CSV file dynamically
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
          const leagueName = parts[0].trim();
          const sdName = parts[1].trim();
          // Skip header row if present
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

async function runWeeklyIngest() {
  console.log("Starting automated weekly replay fetch...");

  const seasonRes = await db.execute("SELECT * FROM seasons ORDER BY season DESC LIMIT 1");
  if (seasonRes.rows.length === 0) {
    console.log("No active seasons found in database.");
    return;
  }
  
  const activeSeason = seasonRes.rows[0];
  const seasonNum = activeSeason.season;
  const startDate = new Date(activeSeason.week_one_start_date);
  
  const now = new Date();
  const diffDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);

  console.log(`Active Season: ${seasonNum} | Current Week: ${currentWeek}`);

  const matchesRes = await db.execute({
    sql: "SELECT * FROM matches WHERE season = ? AND week = ?",
    args: [seasonNum, currentWeek]
  });

  if (matchesRes.rows.length === 0) {
    console.log(`No matches scheduled for Season ${seasonNum}, Week ${currentWeek}.`);
    return;
  }

  const weekStartTimestamp = Math.floor((startDate.getTime() + (currentWeek - 1) * 7 * 86400000) / 1000);

  for (const match of matchesRes.rows) {
    const { match_id, player_1, player_2 } = match;
    
    const sdPlayer1 = getShowdownName(player_1);
    const sdPlayer2 = getShowdownName(player_2);

    console.log(`Checking match: ${player_1} (${sdPlayer1}) vs ${player_2} (${sdPlayer2})`);

    const url = `https://replay.pokemonshowdown.com/search.json?user=${encodeURIComponent(sdPlayer1)}&user2=${encodeURIComponent(sdPlayer2)}`;
    
    try {
      const response = await fetch(url);
      const json = await response.json();

      if (!json || json.length === 0) {
        console.log(` -> No replays found.`);
        continue;
      }

      const filtered = json
        .filter(battle => Number(battle.uploadtime) > weekStartTimestamp)
        .sort((a, b) => Number(a.uploadtime) - Number(b.uploadtime));

      console.log(` -> Found ${filtered.length} valid game(s) uploaded this week.`);

      for (let i = 0; i < Math.min(filtered.length, 3); i++) {
        const battleId = filtered[i].id;
        const gameNumber = i + 1;
        const gameId = `${match_id}_g${gameNumber}`;
        const replayUrl = `https://replay.pokemonshowdown.com/${battleId}`;

        const existingGame = await db.execute({
          sql: "SELECT game_id FROM match_games WHERE game_id = ?",
          args: [gameId]
        });

        if (existingGame.rows.length > 0) {
          console.log(`    [Game ${gameNumber}] Already ingested. Skipping.`);
          continue;
        }

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

        await db.execute({
          sql: `INSERT OR REPLACE INTO match_games (game_id, match_id, game_number, replay_url, winner, loser, turns) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [gameId, match_id, gameNumber, replayUrl, winner, loser, turns]
        });

        console.log(`    [Game ${gameNumber}] Recorded: Winner=${winner}, Turns=${turns}`);
      }

    } catch (e) {
      console.error(`Error processing match ${match_id}:`, e.message);
    }
  }
}

runWeeklyIngest();
