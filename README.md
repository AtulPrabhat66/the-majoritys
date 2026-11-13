# THE MAJORITY

A browser game prototype plus a Node.js WebSocket multiplayer server.

## Files
- `index.html` — original offline prototype with simulated opponents.
- `online.html` — browser client for real online matches.
- `server.js` — WebSocket matchmaking and game server.
- `package.json` — Node.js dependency and start script.
- `render.yaml` — deployment blueprint for Render.
- `.env.example` — local configuration example.

## Online game rules implemented server-side
- Matchmaking forms rooms of 50 players by default.
- Each vote round has a 10-second timer.
- Players choose YES or NO; the larger side survives.
- Ties repeat without eliminating voters.
- Non-voting players are removed when a round resolves.
- Final two receive different quiz questions.
- Matching results lead to REPEAT/RANDOM choices; differing choices start Quick Question.
- Quick Question awards a point to the first correct answer; first to 10 points wins.
- Consecutive win streak is tracked for the current server session.

## Run locally
Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Then open `online.html` in a browser and connect to `ws://localhost:3000`.

Health check: `http://localhost:3000/health`.

## Deploy
The repository includes `render.yaml` for a Render web service. Create a new Blueprint deployment from this repository. The service runs the Node server and exposes a `/health` endpoint. After deployment, use the service's secure WebSocket address (usually `wss://YOUR-SERVICE.onrender.com`) in `online.html`.

Free hosting may sleep or have resource limits. It is suitable for early testing, not a guarantee of stable 50-player production capacity. Test capacity before inviting players.

## Important limitations
- The server currently keeps match state and win streaks in memory. Restarting the service clears active rooms and streaks.
- There is no account system, persistent database, anti-cheat system, or global leaderboard yet.
- Keep `MATCH_SIZE=50` for the planned full match. You can temporarily set a lower number (for example 2) in the server environment for controlled testing.
- GitHub stores the source code; it does not run this server.
