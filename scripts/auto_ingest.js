import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

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

function getShowdownName(leagueName) {
  return showdownAliases[leagueName] || leagueName.trim();
}

// --- CORE LOGIC & BATTLE DETAIL FUNCTIONS ---

function _getPlayerDetails(data, players, playerIdentifier) {
  let targetPlayerName;
  let playerTag; // "p1" or "p2"

  if (playerIdentifier === 1 || playerIdentifier === "1") {
    targetPlayerName = players[0];
    playerTag = "p1";
  } else if (playerIdentifier === 2 || playerIdentifier === "2") {
    targetPlayerName = players[1];
    playerTag = "p2";
  } else if (playerIdentifier.toLowerCase() === "winner") {
    targetPlayerName = getWinner(data);
    if (targetPlayerName === players[0]) {
      playerTag = "p1";
    } else if (targetPlayerName === players[1]) {
      playerTag = "p2";
    }
  } else if (playerIdentifier.toLowerCase() === "loser") {
    targetPlayerName = getLoser(data);
    if (targetPlayerName === players[0]) {
      playerTag = "p1";
    } else if (targetPlayerName === players[1]) {
      playerTag = "p2";
    }
  } else {
    targetPlayerName = playerIdentifier;
    if (targetPlayerName === players[0]) {
      playerTag = "p1";
    } else if (targetPlayerName === players[1]) {
      playerTag = "p2";
    }
  }

  if (targetPlayerName && playerTag) {
    return { targetPlayerName, playerTag };
  }
  return null;
}

function _getNicknameToSpeciesMap(log, playerTag) {
	const map = {};
	const logLines = log.split('\n');
	logLines.forEach(line => {
		if (line.startsWith(`|switch|${playerTag}`) || line.startsWith(`|drag|${playerTag}`)) {
			const parts = line.split('|');
			const nickname = parts[2].split(': ')[1].trim();
			let species = parts[3].split(',')[0].trim();
			if (species.endsWith("-*")) {
				species = species.slice(0, -2);
			}
			if (!map[nickname] || !(map[nickname].includes("-Mega") || map[nickname].includes("-Primal") || map[nickname].includes("-Gmax"))) {
				map[nickname] = species;
			}
		}
		if (line.startsWith(`|detailschange|${playerTag}`) && !line.includes('[silent]')) {
			const parts = line.split('|');
			const nickname = parts[2].split(': ')[1].trim();
			const newSpecies = parts[3].split(',')[0].trim();

			if (newSpecies.includes("-Mega") || newSpecies.includes("-Primal") || newSpecies.includes("-Gmax")) {
				map[nickname] = newSpecies;
			}
		}
	});
	return map;
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
			if (pokemonName.endsWith("-*")) {
				pokemonName = pokemonName.slice(0, -2);
			}
			if (!initialPokemon.includes(pokemonName)) {
				initialPokemon.push(pokemonName);
			}
		}
		if (line.startsWith(`|switch|${playerTag}`) || line.startsWith(`|drag|${playerTag}`)) {
			const parts = line.split('|');
			const nickname = parts[2].split(': ')[1].trim();
			const species = parts[3].split(',')[0].trim();
			if (!nicknameToInitialSpecies.has(nickname)) {
				nicknameToInitialSpecies.set(nickname, species);
			}
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

function _getFaintCauseAndSourceFromIndirectDamage(logLines, faintIndex, faintingPokemonNickname, faintingPokemonBaseSpecies, opponentPlayerTag, opponentNicknameMap, faintingPlayerTag, faintingPlayerNicknameMap = {}) {
    function _getSpeciesFromLog(logLines, nickname, startIndex) {
        for (let i = startIndex; i >= 0; i--) {
            const line = logLines[i];
            if (line.startsWith('|switch|')) {
                const parts = line.split('|');
                if (parts[2] && parts[2].includes(nickname)) {
                    return parts[3].split(',')[0].trim();
                }
            }
        }
        return null;
    }

    let damageLineIndex = faintIndex - 1;
    while (damageLineIndex >= 0 && (!logLines[damageLineIndex].includes('|-damage|') || !(logLines[damageLineIndex].includes(faintingPokemonNickname) || logLines[damageLineIndex].includes(faintingPokemonBaseSpecies)))) {
        damageLineIndex--;
    }
    const damageLine = logLines[damageLineIndex];

    if (!damageLine) {
        return { source: "Unknown", move: "Unknown" };
    }

    for (let j = faintIndex - 1; j >= 0; j--) {
        const line = logLines[j];
        if (line.startsWith('|-end|') && line.includes('move: Future Sight') && line.includes(faintingPokemonNickname)) {
            for (let k = j - 1; k >= 0; k--) {
                const moveLine = logLines[k];
                if (moveLine.startsWith('|move|') && moveLine.includes(`|Future Sight|`) && moveLine.includes(opponentPlayerTag)) {
                    const parts = moveLine.split('|');
                    const sourceNickname = parts[2].split(': ')[1].trim();
                    const sourceSpecies = opponentNicknameMap[sourceNickname] || _getSpeciesFromLog(logLines, sourceNickname, k) || sourceNickname;
                    return { source: sourceSpecies, move: "Future Sight" };
                }
            }
        }
    }

    if (damageLine.includes('[from] item: Rocky Helmet')) {
      const sourceTagMatch = damageLine.match(/\[of\]\s(p[12]a:\s[\w\s-]+)/);
      if (sourceTagMatch) {
          const sourcePokemonNickname = sourceTagMatch[1].split(': ')[1].trim();
          const sourceSpecies = opponentNicknameMap[sourcePokemonNickname] || _getSpeciesFromLog(logLines, sourcePokemonNickname, damageLineIndex) || sourcePokemonNickname;
          return { source: sourceSpecies, move: "Rocky Helmet" };
      }
      return { source: "Unknown", move: "Rocky Helmet" };
    }

    const abilityMatch = damageLine.match(/\[from\] ability: (Iron Barbs|Rough Skin)/);
    if (abilityMatch) {
        const abilityName = abilityMatch[1];
        const sourceTagMatch = damageLine.match(/\[of\]\s(p[12]a:\s[\w\s-]+)/);
        if (sourceTagMatch) {
            const sourcePokemonNickname = sourceTagMatch[1].split(': ')[1].trim();
            const sourceSpecies = opponentNicknameMap[sourcePokemonNickname] || _getSpeciesFromLog(logLines, sourcePokemonNickname, damageLineIndex) || sourcePokemonNickname;
            return { source: sourceSpecies, move: abilityName };
        }
        return { source: "Unknown", move: abilityName };
    }

    if (damageLine.includes('[from] Sandstorm') || damageLine.includes('[from] Hail')) {
      const weatherName = damageLine.includes('Sandstorm') ? 'Sandstorm' : 'Hail';
      for (let j = 0; j < faintIndex; j++) {
          const line = logLines[j];
          if (line.startsWith(`|-weather|${weatherName}`) && line.includes('[from]')) {
              const ofTagMatch = line.match(/\[of\]\s(p[12]a:\s[\w\s-]+)/);
              if (ofTagMatch) {
                  const sourcePokemonTag = ofTagMatch[1];
                  const sourcePokemonNickname = sourcePokemonTag.split(': ')[1].trim();
                  const sourcePlayerTag = sourcePokemonTag.includes(opponentPlayerTag) ? opponentPlayerTag : faintingPlayerTag;
                  const sourceNicknameMap = (sourcePlayerTag === opponentPlayerTag) ? opponentNicknameMap : faintingPlayerNicknameMap;
                  const sourceSpecies = sourceNicknameMap[sourcePokemonNickname] || _getSpeciesFromLog(logLines, sourcePokemonNickname, j) || sourcePokemonNickname;
                  return { source: sourceSpecies, move: weatherName };
              }
          }
      }
      return { source: "Unknown", move: weatherName };
    }

    if (damageLine.includes('[from] status') || damageLine.includes('[from] residual') || damageLine.includes('[from] psn') || damageLine.includes('[from] tox') || damageLine.includes('[from] brn')) {
        const statusMatch = damageLine.match(/\[from\]\s(?:status:\s)?([a-z]+)/);
        const status = statusMatch ? statusMatch[1].toUpperCase() : 'UNKNOWN';

        if (damageLine.includes('[from] psn') || damageLine.includes('[from] tox')) {
            for (let i = 0; i < faintIndex; i++) {
                const line = logLines[i];
                if (line.startsWith(`|-sidestart|${faintingPlayerTag}: `) && line.includes('move: Toxic Spikes')) {
                    for (let j = i - 1; j >= 0; j--) {
                        const moveLine = logLines[j];
                        if (moveLine.startsWith('|move|') && moveLine.includes(`|Toxic Spikes|`) && moveLine.includes(opponentPlayerTag)) {
                            const parts = moveLine.split('|');
                            const sourceNickname = parts[2].split(': ')[1].trim();
                            const sourceSpecies = opponentNicknameMap[sourceNickname] || _getSpeciesFromLog(logLines, sourceNickname, j) || sourceNickname;
                            return { source: sourceSpecies, move: "Toxic Spikes (PSN)" };
                        }
                    }
                }
            }
        }

        for (let j = damageLineIndex - 1; j >= 0; j--) {
            const line = logLines[j];
            if (line.startsWith('|-status|') && (line.includes(faintingPokemonNickname) || line.includes(faintingPokemonBaseSpecies))) {
                for (let k = j - 1; k >= 0; k--) {
                    const moveLine = logLines[k];
                    if (moveLine.startsWith('|move|') && moveLine.includes(`|${opponentPlayerTag}`)) {
                        const parts = moveLine.split('|');
                        const sourceNickname = parts[2].split(': ')[1].trim();
                        const sourceSpecies = opponentNicknameMap[sourceNickname] || _getSpeciesFromLog(logLines, sourceNickname, k) || sourceNickname;
                        const move = parts[3].trim();
                        return { source: sourceSpecies, move: `${move} (${status})` };
                    }
                }
            }
        }
        return { source: "Unknown", move: `(Status) (${status})` };
    }

    if (damageLine.includes('[from] confusion')) {
        for (let j = damageLineIndex - 1; j >= 0; j--) {
            const moveLine = logLines[j];
            if (moveLine.startsWith('|move|') && (moveLine.includes(faintingPokemonNickname) || moveLine.includes(faintingPokemonBaseSpecies))) {
                const parts = moveLine.split('|');
                const sourceNickname = parts[2].split(': ')[1].trim();
                const sourceSpecies = opponentNicknameMap[sourceNickname] || _getSpeciesFromLog(logLines, sourceNickname, j) || sourceNickname;
                const move = parts[3].trim();
                return { source: sourceSpecies, move: `${move} (Confusion)` };
            }
        }
    }

    if (damageLine.includes('[from] Stealth Rock') || damageLine.includes('[from] Spikes')) {
        const hazardName = damageLine.includes('Stealth Rock') ? 'Stealth Rock' : 'Spikes';
        for (let j = 0; j < faintIndex; j++) {
            const line = logLines[j];
            if (line.startsWith(`|move|${opponentPlayerTag}a:`) && line.includes(`|${hazardName}|`)) {
                const parts = line.split('|');
                const sourceNickname = parts[2].split(': ')[1].trim();
                const sourceSpecies = opponentNicknameMap[sourceNickname] || _getSpeciesFromLog(logLines, sourceNickname, j) || sourceNickname;
                const move = parts[3].trim();
                return { source: sourceSpecies, move: move };
            }
        }
        return { source: "Unknown", move: hazardName };
    }

    if (damageLine.includes('[from] Leech Seed')) {
        const parts = damageLine.split('[of]');
        const sourcePokemonTag = parts[1].trim().split('\n')[0];
        const sourceNickname = sourcePokemonTag.split(': ')[1].trim();
        const sourceSpecies = opponentNicknameMap[sourceNickname] || _getSpeciesFromLog(logLines, sourceNickname, damageLineIndex) || sourceNickname;
        return { source: sourceSpecies, move: "Leech Seed" };
    }
    if (damageLine.includes('[from] item: Sticky Barb')) {
        return { source: "Sticky Barb", move: "Sticky Barb" };
    }

    return { source: "Unknown", move: "Unknown" };
}

function getForfeit(data, playerTag) {
    const log = data.log;
    const players = data.players;
    const playerIdentifier = (playerTag === 'p1' ? 0 : 1);
    const playerName = players[playerIdentifier];
    const forfeitMessage = `|-message|${playerName} forfeited.`;

    if (log.includes(forfeitMessage)) return true;
    const inactiveMessage = `|-message|${playerName} lost due to inactivity.`;
    if (log.includes(inactiveMessage)) return true;
    return false;
}

function getWinner(data) {
  const log = data.log;
  const winnerLine = log.split('|win|')[1];
  if (winnerLine) {
    return winnerLine.split('\n')[0].trim();
  }
  return "Winner not found.";
}

function getLoser(data) {
  const players = data.players;
  const winnerName = getWinner(data);
  if (winnerName === "Winner not found.") return "Loser not found.";
  const loserName = players.find(player => player !== winnerName);
  return loserName || "Loser not found.";
}

function getTurns(data) {
  const log = data.log;
  const turnLines = log.split('|turn|');
  const lastTurnLine = turnLines[turnLines.length - 1];
  const turnNumber = parseInt(lastTurnLine.split('\n')[0].trim(), 10);
  return (!isNaN(turnNumber)) ? turnNumber : 0;
}

function getPokemon(data, playerIdentifier, pokemonId) {
	const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return "Player not found.";
  const { playerTag } = playerDetails;
  const pokemonList = _getPokemonList(log, playerTag);
  return (pokemonId > 0 && pokemonId <= pokemonList.length) ? pokemonList[pokemonId - 1] : "Pokémon not found for the specified ID.";
}

function getNickname(data, playerIdentifier, pokemonId) {
	const log = data.log;
	const players = data.players;
	const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
	if (!playerDetails) return "Player not found.";
	const { playerTag } = playerDetails;
	const logLines = log.split('\n');

	const initialPokemonOrder = [];
	const nicknameMap = new Map();

	for (const line of logLines) {
		if (line.startsWith(`|poke|${playerTag}|`)) {
			const parts = line.split('|');
			let species = parts[3].split(',')[0].trim();
			if (species.endsWith("-*")) species = species.slice(0, -2);
			initialPokemonOrder.push(species);
		}
		if ((line.startsWith(`|switch|${playerTag}`) || line.startsWith(`|drag|${playerTag}`)) && !line.includes('fainted')) {
			const parts = line.split('|');
			const species = parts[3].split(',')[0].trim();
			const nickname = parts[2].split(': ')[1].trim();
			if (!nicknameMap.has(species)) nicknameMap.set(species, nickname);
		}
	}

	if (pokemonId < 1 || pokemonId > initialPokemonOrder.length) return "Nickname not found for the specified Pokémon ID.";
	const targetSpecies = initialPokemonOrder[pokemonId - 1];
	const foundNickname = nicknameMap.get(targetSpecies);
	return foundNickname || targetSpecies;
}

function getBattleWon(data, playerIdentifier, pokemonId) {
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return 0;
  const winnerName = getWinner(data);
  return (playerDetails.targetPlayerName === winnerName) ? 1 : 0;
}

function getFaintType(data, playerIdentifier, pokemonId) {
  const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return "Player not found.";
  const { playerTag } = playerDetails;
  const opponentPlayerTag = (playerTag === 'p1' ? 'p2' : 'p1');

  const pokemonList = _getPokemonList(log, playerTag);
  if (pokemonId < 1 || pokemonId > pokemonList.length) return "Pokémon not found for the specified ID.";

  const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);
  const logLines = log.split('\n');
  let faintIndex = -1;

  for (let i = 0; i < logLines.length; i++) {
    const line = logLines[i];
    if (line.startsWith(`|faint|${playerTag}`) && line.includes(targetPokemonNickname)) {
      faintIndex = i;
      break;
    }
  }

  if (faintIndex === -1) {
    const targetPokemonSpecies = pokemonList[pokemonId - 1];
    for (let i = 0; i < logLines.length; i++) {
      const line = logLines[i];
      if (line.startsWith(`|faint|${playerTag}`) && line.includes(targetPokemonSpecies)) {
        faintIndex = i;
        break;
      }
    }
  }

  if (faintIndex === -1) return "N/A";

  const selfKO_moves = ["Self-Destruct", "Explosion", "Final Gambit", "Memento", "Healing Wish", "Misty Explosion", "Lunar Dance"];

  for (let i = faintIndex - 1; i >= 0; i--) {
    const line = logLines[i];
    if (line.startsWith('|turn|')) break;

    if (line.startsWith('|-end|') && line.includes('move: Future Sight')) return "Indirect";

    if (line.startsWith('|move|') && line.includes(`|${opponentPlayerTag}`)) {
      const parts = line.split('|');
      const moveTarget = parts[4];
      if (moveTarget && moveTarget.includes(targetPokemonNickname)) return "Direct";
    }

    if (line.startsWith('|move|') && selfKO_moves.some(move => line.includes(move)) && line.includes(targetPokemonNickname)) {
      return "Self";
    }

    if (line.startsWith('|-damage|')) {
      const parts = line.split('|');
      const damagedPokemon = parts[2];
      if (damagedPokemon && damagedPokemon.includes(targetPokemonNickname)) {
        if (line.includes('[from]')) {
          if (line.includes('[from] Recoil') || line.includes('[from] recoil') || line.includes('[from] item: Life Orb') ||
            line.includes('[from] item: Sticky Barb') || line.includes('[from] highjumpkick') || line.includes('[from] confusion')) {
            return "Self";
          } else {
            return "Indirect";
          }
        }
      }
    }
  }
  return "Unknown";
}

function getFaintSource(data, playerIdentifier, pokemonId) {
	const log = data.log;
	const players = data.players;
	const logLines = log.split('\n');
  const pokemonToFind = getNickname(data, playerIdentifier, pokemonId);
  const baseSpeciesName = pokemonToFind.split('-')[0];
	const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
	if (!playerDetails) return "Player not found.";
	const { playerTag, targetPlayerName } = playerDetails;

	const pokemonList = _getPokemonList(log, playerTag);
	if (pokemonId < 1 || pokemonId > pokemonList.length) return "Pokémon not found for the specified ID.";

	let faintIndex = -1;
	for (let i = 0; i < logLines.length; i++) {
		const line = logLines[i];
		if (line.startsWith(`|faint|${playerTag}`) && line.includes(pokemonToFind)) {
			faintIndex = i;
			break;
		}
	}

  if (faintIndex === -1) {
    const pokemonFainted = log.includes(`|faint|${playerTag}a: ${pokemonToFind}`);
    const winnerName = getWinner(data);
    if (winnerName !== "Winner not found.") {
        const opponentName = (players[0] === targetPlayerName) ? players[1] : players[0];
        if (winnerName === opponentName && getForfeit(data, playerTag) && !pokemonFainted) {
            return getLoser(data);
        }
    }
    return "N/A";
	}

	const opponentPlayerTag = (playerTag === 'p1' ? 'p2' : 'p1');
	const opponentNicknameMap = _getNicknameToSpeciesMap(log, opponentPlayerTag);
  const faintType = getFaintType(data, playerIdentifier, pokemonId);
  
  if (faintType === "N/A" || faintType.includes("not found")) return "N/A";
  if (faintType === "Direct") {
    for (let i = faintIndex - 1; i >= 0; i--) {
        const line = logLines[i];
        if (line.startsWith('|move|') && line.includes(opponentPlayerTag)) {
            const parts = line.split('|');
            const sourceNickname = parts[2].split(': ')[1].trim();
            return opponentNicknameMap[sourceNickname] || sourceNickname;
        }
    }
  } else if (faintType === "Self") {
    return "Self";
  } else if (faintType === "Indirect") {
    const result = _getFaintCauseAndSourceFromIndirectDamage(logLines, faintIndex, pokemonToFind, baseSpeciesName, opponentPlayerTag, opponentNicknameMap, playerDetails.playerTag);
    return result.source;
  }
  return "Unknown";
}

function getFaintMove(data, playerIdentifier, pokemonId) {
	const log = data.log;
	const players = data.players;
	const logLines = log.split('\n');
  const pokemonToFind = getNickname(data, playerIdentifier, pokemonId);
	const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  const baseSpeciesName = pokemonToFind.split('-')[0];
	if (!playerDetails) return "Player not found.";
	const { playerTag, targetPlayerName } = playerDetails;

	const pokemonList = _getPokemonList(log, playerTag);
	if (pokemonId < 1 || pokemonId > pokemonList.length) return "Pokémon not found for the specified ID.";

	let faintIndex = -1;
	for (let i = 0; i < logLines.length; i++) {
		const line = logLines[i];
		if (line.startsWith(`|faint|${playerTag}`) && line.includes(pokemonToFind)) {
			faintIndex = i;
			break;
		}
	}

    if (faintIndex === -1) {
      const pokemonFainted = log.includes(`|faint|${playerTag}a: ${pokemonToFind}`);
      const winnerName = getWinner(data);
      if (winnerName !== "Winner not found.") {
          const opponentName = (players[0] === targetPlayerName) ? players[1] : players[0];
          if (winnerName === opponentName && getForfeit(data, playerTag) && !pokemonFainted) {
              return "Forfeit";
          }
      }
      return "N/A";
	}

	const opponentPlayerTag = (playerTag === 'p1' ? 'p2' : 'p1');
  const faintType = getFaintType(data, playerIdentifier, pokemonId);
  
  if (faintType === "N/A" || faintType.includes("not found")) return "N/A";

  if (faintType === "Direct") {
    for (let i = faintIndex - 1; i >= 0; i--) {
        const line = logLines[i];
        if (line.startsWith('|move|')) {
            const parts = line.split('|');
            return parts[3].trim();
        }
    }
  } else if (faintType === "Self") {
    for (let i = faintIndex - 1; i >= 0; i--) {
      const line = logLines[i];
      const selfKO_moves = ["Self-Destruct", "Explosion", "Final Gambit", "Memento", "Healing Wish", "Misty Explosion", "Lunar Dance"];
      if (line.startsWith('|move|') && selfKO_moves.some(move => line.includes(move))) {
          const parts = line.split('|');
          const movedByPokemon = parts[2].split(': ')[1].trim();
          if (movedByPokemon === pokemonToFind || movedByPokemon === baseSpeciesName) {
              return parts[3].trim();
          }
      }
      if (line.startsWith('|-damage|') && line.includes('0 fnt')) {
          if (line.includes('[from] confusion')) return "Confusion Damage";
          if (line.includes('[from] Recoil') || line.includes('[from] recoil')) return "Recoil";
          if (line.includes('[from] item: Life Orb')) return "Life Orb";
          if (line.includes('[from] highjumpkick')) return "Crash";
          if (line.includes('[from] item: Sticky Barb')) return "Sticky Barb";
      }
    }
  } else if (faintType === "Indirect") {
    const result = _getFaintCauseAndSourceFromIndirectDamage(logLines, faintIndex, pokemonToFind, baseSpeciesName, opponentPlayerTag, {}, playerDetails.playerTag);
    return result.move;
  }
  return "Unknown";
}

function getBattleSurvived(data, playerIdentifier, pokemonId) {
  const battleWon = getBattleWon(data, playerIdentifier, pokemonId);
  const faintType = getFaintType(data, playerIdentifier, pokemonId);
  if (typeof battleWon === 'string') return battleWon;
  if (typeof faintType === 'string' && faintType.includes("not found")) return faintType;
  return (battleWon === 1 && faintType === "N/A") ? 1 : 0;
}

function getBattleFainted(data, playerIdentifier, pokemonId) {
  const battleWon = getBattleWon(data, playerIdentifier, pokemonId);
  const faintType = getFaintType(data, playerIdentifier, pokemonId);
  if (typeof battleWon === 'string') return battleWon;
  if (typeof faintType === 'string' && faintType.includes("not found")) return faintType;
  return (battleWon === 0 || faintType !== "N/A") ? 1 : 0;
}

function getActiveTurns(data, playerIdentifier, pokemonId) {
  const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return 0;
  const { playerTag } = playerDetails;
  const targetPokemonSpecies = getPokemon(data, playerIdentifier, pokemonId);
  const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);

  let activeTurns = 0;
  const logLines = log.split('\n');
  let currentTurn = 0;
  const turnsWithMoves = new Set();

  logLines.forEach(line => {
    if (line.startsWith('|turn|')) {
      currentTurn = parseInt(line.split('|')[2]);
    }
    if (line.startsWith(`|move|${playerTag}a:`)) {
      const parts = line.split('|');
      const pokemonNameInLog = parts[2].split(': ')[1].split('|[')[0].trim();
      if ((pokemonNameInLog === targetPokemonSpecies || pokemonNameInLog === targetPokemonNickname) && !turnsWithMoves.has(currentTurn)) {
        activeTurns++;
        turnsWithMoves.add(currentTurn);
      }
    }
  });
  return activeTurns;
}

function getBattleKOs(data, playerIdentifier, pokemonId, koType) {
  const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return 0;
  const { playerTag } = playerDetails;
  const targetPokemonSpecies = getPokemon(data, playerIdentifier, pokemonId);
  let koCount = 0;

  if (koType === "Self") {
      const playerPokemonList = _getPokemonList(log, playerTag);
      for (let i = 1; i <= playerPokemonList.length; i++) {
          const faintSource = getFaintSource(data, playerIdentifier, i);
          if (faintSource === targetPokemonSpecies) koCount++;
          if (i === pokemonId && faintSource === "Self") koCount++;
      }
      return koCount;
  }

  const opponentPlayerTag = (playerTag === 'p1' ? 'p2' : 'p1');
  const opponentPokemonList = _getPokemonList(log, opponentPlayerTag);

  for (let i = 1; i <= opponentPokemonList.length; i++) {
    const opponentPokemonSpecies = getPokemon(data, (opponentPlayerTag === 'p1' ? "1" : "2"), i);
    const faintSource = getFaintSource(data, (opponentPlayerTag === 'p1' ? "1" : "2"), i);
    const faintType = getFaintType(data, (opponentPlayerTag === 'p1' ? "1" : "2"), i);

    if (faintSource === targetPokemonSpecies && faintType === koType) {
        koCount++;
    }
  }
  return koCount;
}

function getDamageTaken(data, playerIdentifier, pokemonId) {
  const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return 0;
  const { playerTag } = playerDetails;
  const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);
  if (targetPokemonNickname.includes("not found")) return 0;

  const logLines = log.split('\n');
  let targetPokemonIdentifier = null;
  let totalDamageTaken = 0;
  let currentHp = null;

  for (const line of logLines) {
    if (line.startsWith('|switch|') && line.includes(targetPokemonNickname)) {
      const parts = line.split('|');
      targetPokemonIdentifier = parts[2];
      currentHp = parseInt(parts[4].split('/')[0], 10);
      break;
    }
  }

  if (targetPokemonIdentifier === null) return 0;

  for (const line of logLines) {
    const parts = line.split('|');
    const lineType = parts[1];
    if (lineType === '-damage' || lineType === '-heal') {
        if (parts[2] === targetPokemonIdentifier) {
            const hpString = parts[3];
            let newHp = hpString.includes('fnt') ? 0 : parseInt(hpString.split('/')[0], 10);
            if (lineType === '-damage') {
              const damageDealt = currentHp - newHp;
              if (damageDealt > 0) totalDamageTaken += damageDealt;
            }
            currentHp = newHp;
        }
    } else if (line.startsWith('|switch|') && parts[2] === targetPokemonIdentifier) {
        currentHp = parseInt(parts[4].split('/')[0], 10);
    }
  }
  return totalDamageTaken;
}

function getDamageHealed(data, playerIdentifier, pokemonId) {
    const log = data.log;
    const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);
    if (targetPokemonNickname.includes("not found")) return 0;

    let totalDamageHealed = 0;
    let currentHp = 0;
    let lastRecordedHpBeforeSwitch = 0;
    let hasSwitchedIn = false;

    for (const line of log.split('\n')) {
        const parts = line.split('|');
        if ((line.startsWith('|switch|') || line.startsWith('|drag|')) && line.includes(targetPokemonNickname)) {
            if (parts.length > 4) {
                let newHp = parseInt(parts[4].split('/')[0], 10);
                if (!hasSwitchedIn) {
                    currentHp = newHp;
                    lastRecordedHpBeforeSwitch = newHp;
                    hasSwitchedIn = true;
                } else {
                    if (newHp > lastRecordedHpBeforeSwitch) {
                        totalDamageHealed += (newHp - lastRecordedHpBeforeSwitch);
                    }
                    currentHp = newHp;
                    lastRecordedHpBeforeSwitch = currentHp;
                }
            }
        }
        if (!hasSwitchedIn) continue;
        const isDamageOrHeal = line.startsWith('|-damage|') || line.startsWith('|-heal|');
        const isTargeted = parts[2] && parts[2].includes(targetPokemonNickname);

        if (isDamageOrHeal && isTargeted && parts.length > 3) {
            let newHp = parts[3].includes('fnt') ? 0 : parseInt(parts[3].split('/')[0], 10);
            if (line.startsWith('|-heal|')) {
                const healedAmount = newHp - currentHp;
                if (healedAmount > 0) totalDamageHealed += healedAmount;
            }
            currentHp = newHp;
            lastRecordedHpBeforeSwitch = currentHp;
        }
    }
    return totalDamageHealed;
}

function getDamageDealt(data, playerIdentifier, pokemonId, damageType) {
  const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return 0;
  const { playerTag } = playerDetails;
  const opponentPlayerTag = (playerTag === 'p1' ? 'p2' : 'p1');

  const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);
  if (targetPokemonNickname.includes("not found")) return 0;

  const logLines = log.split('\n');
  let totalDirectDamage = 0;
  let totalIndirectDamage = 0;
  let totalHazardDamage = 0;

  const passiveSources = new Map();
  let activePlayerPokemonNickname = null;
  const moveHistory = [];
  const opponentTeam = _getPokemonList(log, opponentPlayerTag);
  const opponentPokemonHp = new Map();
  for (const species of opponentTeam) opponentPokemonHp.set(species, 100);

  for (let i = 0; i < logLines.length; i++) {
    const line = logLines[i];
    const parts = line.split('|');

    if (line.startsWith(`|switch|${playerTag}`) || line.startsWith(`|drag|${playerTag}`)) {
      activePlayerPokemonNickname = parts[2].split(': ')[1].trim();
    }

    if (line.startsWith('|move|') && line.includes(`|${playerTag}`)) {
      const attackerNickname = parts[2].split(': ')[1].trim();
      moveHistory.push({ attacker: attackerNickname, move: parts[3].trim() });
      if (moveHistory.length > 5) moveHistory.shift();
    }

    if (line.startsWith('|-damage|') && parts[2].startsWith(opponentPlayerTag)) {
      const damageTargetNickname = parts[2].split(': ')[1].trim();
      const hpString = parts[3];
      let newHp = hpString.includes('fnt') ? 0 : parseInt(hpString.split('/')[0], 10);
      const damageTargetSpecies = _getNicknameToSpeciesMap(log, opponentPlayerTag)[damageTargetNickname];
      const oldHp = opponentPokemonHp.get(damageTargetSpecies) || 100;
      const damage = oldHp - newHp;
      opponentPokemonHp.set(damageTargetSpecies, newHp);

      if (damage > 0) {
        if (line.includes('[from]')) {
          const fromSource = parts[4].trim();
          let source = null;
          if (fromSource === '[from] Stealth Rock' || fromSource === '[from] Spikes') {
            source = passiveSources.get(fromSource.replace('[from] ', ''));
            if (source === targetPokemonNickname) totalHazardDamage += damage;
          }
          if (source === targetPokemonNickname) totalIndirectDamage += damage;
        } else {
          const lastMove = moveHistory[moveHistory.length - 1];
          if (lastMove && lastMove.attacker === targetPokemonNickname) totalDirectDamage += damage;
        }
      }
    }
  }

  const type = damageType ? damageType.toLowerCase() : 'total';
  if (type === 'direct') return totalDirectDamage;
  if (type === 'indirect') return totalIndirectDamage;
  if (type === 'hazard') return totalHazardDamage;
  return totalDirectDamage + totalIndirectDamage;
}

function getHitsTaken(data, playerIdentifier, pokemonId) {
  const log = data.log;
  const players = data.players;
  const playerDetails = _getPlayerDetails(data, players, playerIdentifier);
  if (!playerDetails) return 0;
  const { playerTag } = playerDetails;
  const targetPokemonNickname = getNickname(data, playerIdentifier, pokemonId);
  if (targetPokemonNickname.includes("not found")) return 0;

  const logLines = log.split('\n');
  let targetPokemonIdentifier = null;
  let hitsTaken = 0;

  for (const line of logLines) {
    if (line.startsWith('|switch|') && line.includes(targetPokemonNickname)) {
      targetPokemonIdentifier = line.split('|')[2];
      break;
    }
  }

  if (targetPokemonIdentifier === null) return 0;

  for (const line of logLines) {
    const parts = line.split('|');
    if (parts[1] === '-damage' && parts[2] === targetPokemonIdentifier) {
      const fromTagExists = parts.length > 4 && parts[4].includes('[from]');
      if (!fromTagExists) hitsTaken++;
    }
  }
  return hitsTaken;
}

// ==========================================
// INGESTION ROUTINE WITH FULL METRIC SUPPORT
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
        
        const sdPlayer1 = getShowdownName(player_1);
        const sdPlayer2 = getShowdownName(player_2);

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
			  
			// REMOVE OR COMMENT OUT THIS CHECK SO IT CAN ALWAYS RE-INGEST & UPDATE:
			/*
			const existingStats = await db.execute({
			  sql: "SELECT COUNT(*) as count FROM match_pokemon_stats WHERE game_id = ?",
			  args: [gameId]
			});
			
			if (existingStats.rows[0].count > 0) {
			  console.log(`    [Game ${gameNumber}] Stats already populated for (${gameId}). Skipping.`);
			  continue;
			}
			*/

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
