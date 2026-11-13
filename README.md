# THE MAJORITY

A browser-based multiplayer elimination game powered by a Node.js WebSocket server.

## Game modes

- **Duel:** 1 human player is matched with an opponent; the server can fill the other seat with a practice bot.
- **Crowd:** up to 50 contenders by default; the server fills empty seats with practice bots after a short matchmaking wait.
- The browser client connects automatically to the same host. There is no separate server-address or Connect screen.

## Rules

- Each YES/NO vote round lasts 10 seconds.
- The larger voting side survives; players on the smaller side are eliminated.
- If votes tie, voters survive and the round repeats.
- Players who do not vote are removed when the round resolves.
- When two players remain, each receives a different quiz question.
- If both finalists get the same result, they choose REPEAT or RANDOM. Different choices start Quick Question.
- Quick Question awards points for correct answers; when both answer correctly, the faster answer scores. First to 10 points wins.
- A winner's streak increases by one; a loss resets it.

## Practice opponents

The server can add bot opponents so a match can start without waiting for other people. Bots use lightweight, randomized decision heuristics and a small quiz-answer lookup; they are not human players or advanced AI. The player-facing roster does not identify bot seats.

## Files

- `online.html` — responsive browser game client.
- `server.js` — WebSocket matchmaking, game rules, and practice bots.
- `package.json` — Node.js dependency and start script.
- `render.yaml` — Render deployment blueprint.
- `.env.example` — local configuration example.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`. The page connects to the local WebSocket server automatically.

Health check: `http://localhost:3000/health`.

## Hosting

The production service is hosted on Render:

- Game: https://the-majority-server.onrender.com
- Health check: https://the-majority-server.onrender.com/health

The service uses `PORT` supplied by Render. `CROWD_SIZE` controls the crowd match size and defaults to 50. Duel size is 2.

## Current limitations

- Match state and win streaks are stored in memory. A server restart clears active matches and streaks.
- There is no account system, persistent database, anti-cheat system, or global leaderboard yet.
- Practice bots use simple heuristics; they do not learn or reason like human players.
- Free hosting may sleep when idle and is intended for early testing, not guaranteed production capacity. Test performance before inviting a large audience.
