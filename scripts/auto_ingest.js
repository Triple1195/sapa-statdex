import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper for polite delay between Showdown API calls
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

function getShowdownName(leagueName) {
  return showdownAliases[leagueName] || leagueName.trim();
}

// Replay Analyzer V8 Engine Helpers
function _getPlayerDetails(data, players, playerIdentifier) {
  let targetPlayerName;
  let playerTag; 

  if (playerIdentifier === 1 || playerIdentifier === "1") {
    targetPlayerName = players[0];
    playerTag = "p1";
  } else if (playerIdentifier === 2 || playerIdentifier === "2") {
    targetPlayerName = players[1];
    playerTag = "p2";
  } else if (playerIdentifier.toLowerCase() === "winner") {
    targetPlayerName = getWinner(data);
    if (targetPlayerName === players[0]) playerTag = "p1";
    else if (targetPlayerName === players[1]) playerTag = "p2";
  } else if (playerIdentifier.toLowerCase() === "loser") {
    targetPlayerName = getLoser(data);
    if (targetPlayerName === players[0]) playerTag = "p1";
    else if (targetPlayerName === players[1]) playerTag = "p2";
  } else {
    targetPlayerName = playerIdentifier;
    if (targetPlayerName === players[0]) playerTag = "p1";
    else if (targetPlayerName === players[1]) playerTag = "p2";
  }

  if (targetPlayerName && playerTag) return { targetPlayerName, playerTag };
  return null;
}

function _getPokemonList(log, playerTag) {
  const logLines = log.split('\n');
  const initialPokemon = [];
  const pokemonForms = new Map();
  const nicknameToInitialSpecies = new Map();

  logLines.forEach(line => {
    if (line.startsWith(`|poke|${playerTag}|`)) {
      const parts = line.split('|');
      let pokemonName = parts[3].split(',')[0].trim();
      if (pokemonName.endsWith("-*")) pokemonName = pokemonName.slice(0, -2);
      if (!initialPokemon.includes(pokemonName)) initialPokemon.push(pokemonName);
    }
    if (line.startsWith(`|switch|${playerTag}`) || line.startsWith(`|drag|${playerTag}`)) {
      const parts = line.split('|');
      const nickname = parts[2].split(': ')[1].trim();
      const species = parts[3].split(',')[0].trim();
      if (!nicknameToInitialSpecies.has(nickname)) nicknameToInitialSpecies.set(nickname, species);
    }
  });

  logLines.forEach(line => {
    if (line.startsWith(`|detailschange|${playerTag}`) && !line.includes('[silent]')) {
      const parts = line.split('|');
      const nickname = parts[2].split(': ')[1].trim();
      const newSpecies = parts[3].split(',')[0].trim();
      let initialSpecies = nicknameToInitialSpecies.get(nickname);
      if (initialSpecies && (newSpecies.includes("-Mega") || newSpecies.includes("-Primal") || newSpecies.includes("-Gmax"))) {
        pokemonForms.set(initialSpecies, newSpecies);
      }
    }
  });

  return initialPokemon.map(species => pokemonForms.get(species) || species);
}

function getWinner(data) {
  const log = data.log || "";
  const winnerLine = log.split('|win|')[1];
  return winnerLine ? winnerLine.split('\n')[0].trim() : "Winner not found.";
}

function getLoser(data) {
  const players = data.players || [];
  const winnerName = getWinner(data);
  if (winnerName === "Winner not found.") return "Loser not found.";
  const loserName = players.find(player => player !== winnerName);
  return loserName || "Loser not found.";
}

function getTurns(data) {
  const log = data.log || "";
  const turnLines = log.split('|turn|');
  const lastTurnLine = turnLines[turnLines.length - 1];
  const turnNumber = parseInt(lastTurnLine.split('\n')[0].trim(), 10);
  return (!isNaN(turnNumber)) ? turnNumber : 0;
}

function getPokemon(data, playerIdentifier, pokemonId) {
  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);
  if (!playerDetails) return "Player not found.";
  const pokemonList = _getPokemonList(data.log, playerDetails.playerTag);
  return (pokemonId > 0 && pokemonId <= pokemonList.length) ? pokemonList[pokemonId - 1] : "Pokémon not found.";
}

function getNickname(data, playerIdentifier, pokemonId) {
  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);
  if (!playerDetails) return "Player not found.";
  const logLines = data.log.split('\n');
  const initialPokemonOrder = [];
  const nicknameMap = new Map();

  for (const line of logLines) {
    if (line.startsWith(`|poke|${playerDetails.playerTag}|`)) {
      let species = line.split('|')[3].split(',')[0].trim();
      if (species.endsWith("-*")) species = species.slice(0, -2);
      initialPokemonOrder.push(species);
    }
    if ((line.startsWith(`|switch|${playerDetails.playerTag}`) || line.startsWith(`|drag|${playerDetails.playerTag}`)) && !line.includes('fainted')) {
      const parts = line.split('|');
      const species = parts[3].split(',')[0].trim();
      const nickname = parts[2].split(': ')[1].trim();
      if (!nicknameMap.has(species)) nicknameMap.set(species, nickname);
    }
  }

  if (pokemonId < 1 || pokemonId > initialPokemonOrder.length) return "Nickname not found.";
  const targetSpecies = initialPokemonOrder[pokemonId - 1];
  return nicknameMap.get(targetSpecies) || targetSpecies;
}

function getBattleWon(data, playerIdentifier, pokemonId) {
  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);
  if (!playerDetails) return 0;
  const winnerName = getWinner(data);
  return (playerDetails.targetPlayerName === winnerName) ? 1 : 0;
}

function getFaintType(data, playerIdentifier, pokemonId) {
  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);
  if (!playerDetails) return "Player not found.";
  const { playerTag } = playerDetails;
  const opponentPlayerTag = (playerTag === 'p1' ? 'p2' : 'p1');
  const pokemonList = _getPokemonList(data.log, playerTag);
  if (pokemonId < 1 || pokemonId > pokemonList.length) return "Pokémon not found.";

  const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);
  const logLines = data.log.split('\n');
  let faintIndex = -1;

  for (let i = 0; i < logLines.length; i++) {
    if (logLines[i].startsWith(`|faint|${playerTag}`) && logLines[i].includes(targetPokemonNickname)) {
      faintIndex = i;
      break;
    }
  }

  if (faintIndex === -1) return "N/A";

  const selfKO_moves = ["Self-Destruct", "Explosion", "Final Gambit", "Memento", "Healing Wish", "Misty Explosion", "Lunar Dance"];

  for (let i = faintIndex - 1; i >= 0; i--) {
    const line = logLines[i];
    if (line.startsWith('|turn|')) break;

    if (line.startsWith('|move|') && line.includes(`|${opponentPlayerTag}`)) {
      const parts = line.split('|');
      if (parts[4] && parts[4].includes(targetPokemonNickname)) return "Direct";
    }
    if (line.startsWith('|move|') && selfKO_moves.some(m => line.includes(m)) && line.includes(targetPokemonNickname)) {
      return "Self";
    }
    if (line.startsWith('|-damage|') && line.includes(targetPokemonNickname)) {
      if (line.includes('[from]')) {
        if (line.includes('Recoil') || line.includes('Life Orb') || line.includes('Sticky Barb') || line.includes('highjumpkick') || line.includes('confusion')) {
          return "Self";
        }
        return "Indirect";
      }
    }
  }
  return "Unknown";
}

function getFaintSource(data, playerIdentifier, pokemonId) {
  const faintType = getFaintType(data, playerIdentifier, pokemonId);
  if (faintType === "N/A" || faintType.includes("not found")) return "N/A";
  if (faintType === "Self") return "Self";

  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);
  const logLines = data.log.split('\n');
  const opponentPlayerTag = (playerDetails.playerTag === 'p1' ? 'p2' : 'p1');

  let faintIndex = -1;
  for (let i = 0; i < logLines.length; i++) {
    if (logLines[i].startsWith(`|faint|${playerDetails.playerTag}`) && logLines[i].includes(getNickname(data, playerIdentifier, pokemonId))) {
      faintIndex = i;
      break;
    }
  }

  if (faintType === "Direct") {
    for (let i = faintIndex - 1; i >= 0; i--) {
      const line = logLines[i];
      if (line.startsWith('|move|') && line.includes(opponentPlayerTag)) {
        const parts = line.split('|');
        const sourceNickname = parts[2].split(': ')[1].trim();
        return sourceNickname;
      }
    }
  }
  return "Unknown";
}

function getFaintMove(data, playerIdentifier, pokemonId) {
  const faintType = getFaintType(data, playerIdentifier, pokemonId);
  if (faintType === "N/A" || faintType.includes("not found")) return "N/A";
  const logLines = data.log.split('\n');
  let faintIndex = -1;
  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);

  for (let i = 0; i < logLines.length; i++) {
    if (logLines[i].startsWith(`|faint|${playerDetails.playerTag}`) && logLines[i].includes(getNickname(data, playerIdentifier, pokemonId))) {
      faintIndex = i;
      break;
    }
  }

  if (faintType === "Direct") {
    for (let i = faintIndex - 1; i >= 0; i--) {
      const line = logLines[i];
      if (line.startsWith('|move|')) {
        return line.split('|')[3].trim();
      }
    }
  }
  return "Unknown";
}

function getBattleSurvived(data, playerIdentifier, pokemonId) {
  return (getBattleWon(data, playerIdentifier, pokemonId) === 1 && getFaintType(data, playerIdentifier, pokemonId) === "N/A") ? 1 : 0;
}

function getBattleFainted(data, playerIdentifier, pokemonId) {
  return (getBattleWon(data, playerIdentifier, pokemonId) === 0 || getFaintType(data, playerIdentifier, pokemonId) !== "N/A") ? 1 : 0;
}

function getBattleKOs(data, playerIdentifier, pokemonId, koType) {
  const playerDetails = _getPlayerDetails(data, data.players, playerIdentifier);
  if (!playerDetails) return 0;
  const targetPokemonSpecies = getPokemon(data, playerIdentifier, pokemonId);
  const opponentPlayerTag = (playerDetails.playerTag === 'p1' ? 'p2' : 'p1');
  const opponentPokemonList = _getPokemonList(data.log, opponentPlayerTag);
  let koCount = 0;

  for (let i = 1; i <= opponentPokemonList.length; i++) {
    const faintSource = getFaintSource(data, (opponentPlayerTag === 'p1' ? "1" : "2"), i);
    const faintType = getFaintType(data, (opponentPlayerTag === 'p1' ? "1" : "2"), i);
    if (faintSource === targetPokemonSpecies && faintType === koType) koCount++;
  }
  return koCount;
}

function getDamageDealt(data, playerIdentifier, pokemonId, damageType) { return 0; }
function getDamageTaken(data, playerIdentifier, pokemonId) { return 0; }
function getDamageHealed(data, playerIdentifier, pokemonId) { return 0; }
function getHitsTaken(data, playerIdentifier, pokemonId) { return 0; }
function getActiveTurns(data, playerIdentifier, pokemonId) { return 0; }


// ==========================================
// MAIN INGESTION ROUTINE WITH BATCHING
// ==========================================

async function runWeeklyIngest() {
  console.log("Starting automated historical & weekly replay fetch with batching...");

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

      let searchUrl = `https://replay.pokemonshowdown.com/search.json?user=${encodeURIComponent(sdPlayer1)}&user2=${encodeURIComponent(sdPlayer2)}`;
      if (format) {
        searchUrl += `&format=${encodeURIComponent(format)}`;
      }
      
      try {
        const response = await fetch(searchUrl);
        const json = await response.json();
        
        // Polite delay to avoid hitting Showdown rate limits during heavy season imports
        await sleep(150);

        if (!json || json.length === 0) {
          continue;
        }

        const filteredJson = json.filter(battle => {
          const t = Number(battle.uploadtime);
          return t > weekStartTime && t <= weekEndTime;
        });
        filteredJson.sort((a, b) => Number(a.uploadtime) - Number(b.uploadtime));

        for (let i = 0; i < Math.min(filteredJson.length, 3); i++) {
          const battleId = filteredJson[i].id;
          const gameNumber = i + 1;
          const gameId = `${match_id}_g${gameNumber}`;
          const replayUrl = `https://replay.pokemonshowdown.com/${battleId}`;

          const existingStats = await db.execute({
            sql: "SELECT COUNT(*) as count FROM match_pokemon_stats WHERE game_id = ?",
            args: [gameId]
          });

          if (existingStats.rows[0].count > 0) {
            console.log(`    [Game ${gameNumber}] Stats already populated for (${gameId}). Skipping.`);
            continue;
          }

          console.log(`    [Game ${gameNumber}] Ingesting & analyzing ${battleId}...`);
          const logRes = await fetch(`${replayUrl}.json`);
          const logData = await logRes.json();
          await sleep(100); // Polite delay between replay log fetches

          const logText = logData.log || "";
          const players = logData.players || [sdPlayer1, sdPlayer2];
          let winner = getWinner(logData);
          let turns = getTurns(logData);
          const loser = (winner.toLowerCase() === players[0].toLowerCase()) ? players[1] : players[0];

          // 1. Insert Game Summary
          await db.execute({
            sql: `INSERT OR REPLACE INTO match_games (game_id, match_id, game_number, replay_url, winner, loser, turns) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [gameId, match_id, gameNumber, replayUrl, winner, loser, turns]
          });

          // 2. Prepare statements for Batch Insert (Sending all Pokémon stats in one Turso call)
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

          // Execute batch write for this game's stats
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
  console.log("\n✅ Ingestion run complete!");
}

runWeeklyIngest();
