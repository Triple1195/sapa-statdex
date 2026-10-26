import { createClient } from "@libsql/client";

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function runWeeklyIngest() {
    console.log("Starting automated weekly replay fetch...");

    // 1. Fetch active season details
    const seasonRes = await db.execute("SELECT * FROM seasons ORDER BY season DESC LIMIT 1");
    if (seasonRes.rows.length === 0) {
        console.log("No active seasons found in database.");
        return;
    }

    const activeSeason = seasonRes.rows[0];
    const seasonNum = activeSeason.season;
    const startDate = new Date(activeSeason.week_one_start_date);

    // 2. Compute current week via date math from Week 1 Monday
    const now = new Date();
    const diffDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
    const currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);

    console.log(`Current active: Season ${seasonNum}, Week ${currentWeek}`);

    // 3. Get matches for the current week
    const matchesRes = await db.execute({
        sql: "SELECT * FROM matches WHERE season = ? AND week = ?",
        args: [seasonNum, currentWeek]
    });

    if (matchesRes.rows.length === 0) {
        console.log(`No matches scheduled for Season ${seasonNum}, Week ${currentWeek}.`);
        return;
    }

    // Calculate Unix timestamp for this week's Monday 00:00:00
    const weekStartTimestamp = Math.floor((startDate.getTime() + (currentWeek - 1) * 7 * 86400000) / 1000);

    for (const match of matchesRes.rows) {
        const { match_id, player_1, player_2 } = match;
        console.log(`Checking replays: ${player_1} vs ${player_2} (Match ID: ${match_id})`);

        // Query Showdown's search API
        const url = `https://replay.pokemonshowdown.com/search.json?user=${encodeURIComponent(player_1)}&user2=${encodeURIComponent(player_2)}`;

        try {
            const response = await fetch(url);
            const json = await response.json();

            if (!json || json.length === 0) {
                console.log(` -> No replays found yet.`);
                continue;
            }

            // Filter battles uploaded strictly after the week's start timestamp & sort ascending
            const filtered = json
            .filter(battle => Number(battle.uploadtime) > weekStartTimestamp)
            .sort((a, b) => Number(a.uploadtime) - Number(b.uploadtime));

            console.log(` -> Found ${filtered.length} valid games uploaded this week.`);

            // Process up to 3 games (Bo3)
            for (let i = 0; i < Math.min(filtered.length, 3); i++) {
                const battleId = filtered[i].id;
                const gameNumber = i + 1;
                const gameId = `${match_id}_g${gameNumber}`;
                const replayUrl = `https://replay.pokemonshowdown.com/${battleId}`;

                console.log(`    [Game ${gameNumber}] ID: ${battleId}`);

                // Check if game is already ingested
                const existingGame = await db.execute({
                    sql: "SELECT game_id FROM match_games WHERE game_id = ?",
                    args: [gameId]
                });

                if (existingGame.rows.length > 0) {
                    console.log(`    [Game ${gameNumber}] Already ingested. Skipping.`);
                    continue;
                }

                // Fetch raw JSON log for parser
                const logRes = await fetch(`${replayUrl}.json`);
                const logData = await logRes.json();

                // TODO: Pass logData into ReplayAnalyzerV8 to extract stats and insert into DB!
            }

        } catch (e) {
            console.error(`Error processing match ${match_id}:`, e.message);
        }
    }
}

runWeeklyIngest();
