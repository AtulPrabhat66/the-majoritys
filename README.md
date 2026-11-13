# THE MAJORITY

A browser-based early playable prototype for **THE MAJORITY**.

## Current build
- Responsive single-page browser interface.
- Simulated 50-player elimination rounds.
- YES/NO choice and 10-second round timer.
- Tie rounds repeat without elimination.
- Final-two screen, repeat/random choices, and a Quick Question mode.
- Local win-streak counter stored in the browser.

## Important limitation
This is currently a **local prototype with simulated opponents**. It does not yet connect real players, provide matchmaking, synchronize rounds across browsers, or maintain a global leaderboard. The displayed vote totals and opponent actions are simulated.

## Run it
Open `index.html` in a modern browser. No build tools are required.

## Planned online architecture
1. Browser client (this project).
2. A Node.js multiplayer server using WebSockets for live rooms and synchronized timers.
3. Persistent storage for player profiles, wins, streaks, and leaderboard.
4. Hosting for the client and server.

GitHub stores the source code; it does not run the multiplayer server by itself.
