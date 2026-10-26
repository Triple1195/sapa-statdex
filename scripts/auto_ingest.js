import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";
import {
  getShowdownName,
  getWinner,
  getLoser,
  getTurns,
  getPokemon,
  getNickname,
  getFaintType,
  getFaintSource,
  getFaintMove,
  getBattleSurvived,
  getBattleFainted,
  getActiveTurns,
  getBattleKOs,
  getDamageTaken,
  getDamageHealed,
  getDamageDealt,
  getHitsTaken,
  _getPlayerDetails,
  _getPokemonList
} from "./parser.js";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const resolveShowdownName = (leagueName) => getShowdownName(leagueName, showdownAliases);

// ==========================================
// INGESTION ROUTINE
// ==========================================

async function runIngest() {
  const targetSeasonEnv = process.env.TARGET_SEASON;
  let seasonsRes;

  if (targetSeasonEnv) {
    console.log(`Targeting single historical import for Season ${targetSeasonEnv}...`);
    seasonsRes = await db.execute({
      sql: "SELECT * FROM seasons WHERE season = ?",
      args: [Number(targetSeasonEnv)]
    });
  } else {
    console.log("No TARGET_SEASON environment variable found. Pulling data for the most current season...");
    seasonsRes = await db.execute("SELECT * FROM seasons ORDER BY season DESC LIMIT 1");
  }

  if (seasonsRes.rows.length === 0) {
    console.log("No matching seasons found in database.");
    return;
  }
  
  for (const activeSeason of seasonsRes.rows) {
    const seasonNum = activeSeason.season;
    const format = activeSeason.format || "";
    const startDateStr = activeSeason.week_one_start_date;
    const startDate = new Date(startDateStr);
    const seasonStartTime = Math.floor(startDate.getTime() / 1000);
    
    const maxWeekRes = await db.execute({
      sql: "SELECT MAX(week) as max_week FROM matches WHERE season = ?",
      args: [seasonNum]
    });
    const seasonMaxWeek = maxWeekRes.rows[0]?.max_week ? Number(maxWeekRes.rows[0].max_week) : 1;

    const now = new Date();
    const diffDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const calculatedWeek = Math.max(1, Math.floor(diffDays / 7) + 1);
    
    const targetWeeks = Math.max(seasonMaxWeek, calculatedWeek);

    console.log(`\n=== Processing Season ${seasonNum} | Format: ${format || 'None'} | Scanning Weeks 1 to ${targetWeeks} ===`);

    for (let w = 1; w <= targetWeeks; w++) {
      console.log(`\n--- Processing Season ${seasonNum}, Week ${w} ---`);

      const matchesRes = await db.execute({
        sql: "SELECT * FROM matches WHERE season = ? AND week = ?",
        args: [seasonNum, w]
      });

      if (matchesRes.rows.length === 0) {
        console.log(`No matches scheduled for Week ${w}.`);
        continue;
      }

      for (const match of matchesRes.rows) {
        const { match_id, player_1, player_2 } = match;
        
        const sdPlayer1 = resolveShowdownName(player_1);
        const sdPlayer2 = resolveShowdownName(player_2);

        let searchUrl = `https://replay.pokemonshowdown.com/search.json?user=${encodeURIComponent(sdPlayer1)}&user2=${encodeURIComponent(sdPlayer2)}`;
        if (format) {
          searchUrl += `&format=${encodeURIComponent(format)}`;
        }
        
        try {
          const response = await fetch(searchUrl);
          const json = await response.json();
          await sleep(150);

          if (!json || json.length === 0) {
            continue;
          }

          const filteredJson = json.filter(battle => {
            const t = Number(battle.uploadtime);
            return t >= seasonStartTime;
          });
          filteredJson.sort((a, b) => Number(a.uploadtime) - Number(b.uploadtime));

          for (let i = 0; i < Math.min(filteredJson.length, 3); i++) {
            const battleId = filteredJson[i].id;
            const gameNumber = i + 1;
            const gameId = `${match_id}_g${gameNumber}`;
            const replayUrl = `https://replay.pokemonshowdown.com/${battleId}`;

            console.log(`    [Game ${gameNumber}] Ingesting & analyzing ${battleId}...`);
            const logRes = await fetch(`${replayUrl}.json`);
            const logData = await logRes.json();
            await sleep(100);

            const logText = logData.log || "";
            const players = logData.players || [sdPlayer1, sdPlayer2];
            let winner = getWinner(logData);
            let turns = getTurns(logData);
            const loser = (winner.toLowerCase() === players[0].toLowerCase()) ? players[1] : players[0];

            await db.execute({
              sql: `INSERT OR REPLACE INTO match_games (game_id, match_id, game_number, replay_url, winner, loser, turns) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              args: [gameId, match_id, gameNumber, replayUrl, winner, loser, turns]
            });

            const batchStatements = [];
            const identifiers = ['Winner', 'Loser'];

            for (const identifier of identifiers) {
              const playerDetails = _getPlayerDetails(logData, logData.players || [sdPlayer1, sdPlayer2], identifier);
              if (!playerDetails) continue;

              const pokemonList = _getPokemonList(logText, playerDetails.playerTag);

              for (let pIdx = 1; pIdx <= pokemonList.length; pIdx++) {
                const species = getPokemon(logData, identifier, pIdx);
                if (!species || species.includes("not found")) continue;

                const nickname = getNickname(logData, identifier, pIdx);
                const faintType = getFaintType(logData, identifier, pIdx);
                const faintSource = getFaintSource(logData, identifier, pIdx);
                const faintMove = getFaintMove(logData, identifier, pIdx);

                const dKos = getBattleKOs(logData, identifier, pIdx, "Direct");
                const iKos = getBattleKOs(logData, identifier, pIdx, "Indirect");
                const sKos = getBattleKOs(logData, identifier, pIdx, "Self");

                const tDmg = getDamageDealt(logData, identifier, pIdx, "Total");
                const dDmg = getDamageDealt(logData, identifier, pIdx, "Direct");
                const iDmg = getDamageDealt(logData, identifier, pIdx, "Indirect");
                const hDmg = getDamageDealt(logData, identifier, pIdx, "Hazard");

                const hTaken = getHitsTaken(logData, identifier, pIdx);
                const dTaken = getDamageTaken(logData, identifier, pIdx);
                const dHealed = getDamageHealed(logData, identifier, pIdx);
                const aTurns = getActiveTurns(logData, identifier, pIdx);

                const survived = getBattleSurvived(logData, identifier, pIdx);
                const fainted = getBattleFainted(logData, identifier, pIdx);
                const bWon = getBattleWon(logData, identifier, pIdx);

                const statId = `${gameId}_${playerDetails.targetPlayerName}_${species}`.replace(/\s+/g, "_");

                batchStatements.push({
                  sql: `INSERT OR REPLACE INTO match_pokemon_stats (
                    stat_id, game_id, player, pokemon, nickname, faint_type, faint_source, faint_move,
                    direct_kos, indirect_kos, self_kos, total_damage, direct_damage, indirect_damage,
                    hazard_damage, hits_taken, damage_taken, damage_healed, active_turns, survived, fainted, battle_won
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  args: [
                    statId, gameId, playerDetails.targetPlayerName, species, nickname, faintType, faintSource, faintMove,
                    dKos, iKos, sKos, tDmg, dDmg, iDmg, hDmg, hTaken, dTaken, dHealed, aTurns, survived, fainted, bWon
                  ]
                });
              }
            }

            if (batchStatements.length > 0) {
              await db.batch(batchStatements);
            }

            console.log(`    [Game ${gameNumber}] Successfully processed and batched stats for ${battleId}!`);
          }

        } catch (e) {
          console.error(`Error processing match ${match_id}:`, e.message);
        }
      }
    }
  }
  console.log("\n✅ Ingestion run complete!");
}

runIngest();
