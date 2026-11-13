const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const CROWD_SIZE = Math.max(2, Number(process.env.CROWD_SIZE || 50));
const SECONDS = 10;
const TARGET_SCORE = 10;

const rooms = new Map();
const queues = { duel: [], crowd: [] };
const fillTimers = { duel: null, crowd: null };

const QUESTIONS = [
  "Should every city have more public parks?",
  "Is teamwork more important than individual talent?",
  "Should school uniforms be optional?",
  "Is it better to be very early than slightly late?",
  "Should public transport be free?",
  "Would you rather have more free time or more money?",
  "Should people be allowed to work from anywhere?",
  "Is reading books better than watching their movie versions?",
  "Should everyone learn how to cook?",
  "Is exploring a new place better than returning to a favourite one?"
];

const QUIZ = [
  { q: "Which planet is known as the Red Planet?", a: ["Venus", "Mars", "Jupiter", "Mercury"], c: 1 },
  { q: "How many sides does a hexagon have?", a: ["5", "6", "7", "8"], c: 1 },
  { q: "Which ocean is the largest?", a: ["Atlantic", "Indian", "Pacific", "Arctic"], c: 2 },
  { q: "What is the chemical symbol for water?", a: ["CO2", "O2", "H2O", "NaCl"], c: 2 },
  { q: "Which animal is the largest living mammal?", a: ["Elephant", "Blue whale", "Giraffe", "Orca"], c: 1 },
  { q: "How many continents are there?", a: ["5", "6", "7", "8"], c: 2 },
  { q: "Which gas do plants absorb from the atmosphere?", a: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], c: 2 },
  { q: "What is the fastest land animal?", a: ["Lion", "Cheetah", "Horse", "Leopard"], c: 1 }
];

const BOT_NAMES = [
  "Mira", "Vex", "Orion", "Nova", "Pixel", "Rook", "Echo", "Blitz",
  "Sage", "Atlas", "Kairo", "Iris", "Zed", "Clover", "Nyx", "Juno",
  "Axel", "Quinn", "Rune", "Skye", "Arlo", "Tess", "Onyx", "Sol"
];
const BOT_STYLES = ["analyst", "contrarian", "social", "risk-taker", "balanced", "instinct"];

function randomId() { return crypto.randomUUID(); }
function randomInt(max) { return crypto.randomInt(max); }
function shufflePick(list) { return list[randomInt(list.length)]; }
function safeSend(p, type, data = {}) {
  if (!p || p.isBot) return;
  if (p.ws.readyState === WebSocket.OPEN) {
    p.ws.send(JSON.stringify({ type, ...data }));
  }
}
function makeBot(usedNames = new Set()) {
  const available = BOT_NAMES.filter(n => !usedNames.has(n));
  const name = available.length ? shufflePick(available) : BOT_NAMES[randomInt(BOT_NAMES.length)] + (randomInt(90) + 10);
  usedNames.add(name);
  return {
    id: "bot-" + randomId(),
    isBot: true,
    name,
    style: shufflePick(BOT_STYLES),
    skill: 0.58 + Math.random() * 0.38,
    room: null,
    strike: 0,
    ws: { readyState: WebSocket.OPEN }
  };
}
function send(p, type, data = {}) {
  if (p.isBot) {
    if (["round", "final-question", "final-choice", "quick-question"].includes(type)) botAct(p, type);
    return;
  }
  safeSend(p, type, data);
}
function cast(r, type, data = {}) {
  for (const p of r.players.values()) {
    if (r.alive.has(p.id) || ["match-result", "match-closed"].includes(type)) send(p, type, data);
  }
}

function botVote(p, r) {
  const yes = [...r.votes.values()].filter(v => v === "YES").length;
  const no = [...r.votes.values()].filter(v => v === "NO").length;
  const q = r.question.toLowerCase();
  let preference = randomInt(2) ? "YES" : "NO";
  if (/teamwork|public parks|public transport|free time|learn how to cook/.test(q)) {
    preference = p.style === "contrarian" ? "NO" : "YES";
  } else if (/uniforms|work from anywhere|early than|new place/.test(q)) {
    preference = p.style === "contrarian" ? "YES" : "NO";
  }
  const crowd = yes === no ? null : (yes > no ? "YES" : "NO");
  if (p.style === "social" && crowd) return crowd;
  if (p.style === "analyst" && crowd && p.skill > 0.72) return crowd;
  if (p.style === "risk-taker" && crowd) return crowd === "YES" ? "NO" : "YES";
  if (p.style === "balanced" && crowd && Math.random() < 0.55) return crowd;
  if (p.style === "instinct" && Math.random() < 0.5) return crowd || preference;
  return preference;
}
function botQuizAnswer(p, question) {
  const known = {
    "Which planet is known as the Red Planet?": 1,
    "How many sides does a hexagon have?": 1,
    "Which ocean is the largest?": 2,
    "What is the chemical symbol for water?": 2,
    "Which animal is the largest living mammal?": 1,
    "How many continents are there?": 2,
    "Which gas do plants absorb from the atmosphere?": 2,
    "What is the fastest land animal?": 1
  };
  if (Object.prototype.hasOwnProperty.call(known, question) && Math.random() < p.skill) return known[question];
  return randomInt(4);
}
function botAct(p, type) {
  const delay = 650 + randomInt(2500);
  setTimeout(() => {
    if (!p.room || !rooms.has(p.room)) return;
    const r = rooms.get(p.room);
    if (type === "round" && r.phase === "vote" && r.alive.has(p.id) && !r.votes.has(p.id)) {
      message(p, { type: "vote", vote: botVote(p, r) });
    } else if (type === "final-question" && r.phase === "final" && r.final && r.final.ids.includes(p.id)) {
      const quiz = r.final.qs.get(p.id);
      if (quiz && !r.final.answers.has(p.id)) message(p, { type: "final-answer", answer: botQuizAnswer(p, quiz.q) });
    } else if (type === "final-choice" && r.phase === "final-choice" && r.final && !r.final.choices.has(p.id)) {
      const choice = p.style === "risk-taker" ? "RANDOM" : p.style === "analyst" ? "REPEAT" : (Math.random() < p.skill ? "REPEAT" : "RANDOM");
      message(p, { type: "final-choice", choice });
    } else if (type === "quick-question" && r.phase === "quick" && r.quick && r.final.ids.includes(p.id) && !r.quick.answers.has(p.id)) {
      message(p, { type: "quick-answer", answer: botQuizAnswer(p, r.quick.q.q) });
    }
  }, delay);
}
function roomSize(mode) { return mode === "crowd" ? CROWD_SIZE : 2; }

function qadd(p, mode = "duel") {
  mode = mode === "crowd" ? "crowd" : "duel";
  p.mode = mode;
  const q = queues[mode];
  const target = roomSize(mode);
  if (!q.includes(p)) q.push(p);
  send(p, "queue", {
    mode,
    position: q.filter(x => !x.isBot).indexOf(p) + 1,
    needed: Math.max(0, target - q.length),
    total: target
  });
  matchmake(mode);
  if (!fillTimers[mode]) {
    fillTimers[mode] = setTimeout(() => {
      fillTimers[mode] = null;
      const waiting = queues[mode];
      if (!waiting.some(x => !x.isBot)) return;
      const used = new Set(waiting.filter(x => x.isBot).map(x => x.name));
      while (waiting.length < target) waiting.push(makeBot(used));
      matchmake(mode);
    }, mode === "duel" ? 1800 : 3500);
  }
}
function matchmake(mode) {
  const q = queues[mode];
  const target = roomSize(mode);
  while (q.length >= target) {
    const candidates = q.splice(0, target);
    const batch = candidates.filter(p => p.isBot || p.ws.readyState === WebSocket.OPEN);
    if (batch.length < 2) {
      for (const p of batch) q.push(p);
      break;
    }
    const r = {
      id: randomId().slice(0, 8),
      mode,
      players: new Map(batch.map(p => [p.id, p])),
      alive: new Set(batch.map(p => p.id)),
      phase: "vote",
      round: 0,
      votes: new Map(),
      timer: null,
      final: null,
      quick: null
    };
    rooms.set(r.id, r);
    batch.forEach(p => { p.room = r.id; });
    const usedNames = new Set();
    const roster = batch.map((p, i) => {
      let name = p.isBot ? p.name : "You";
      if (usedNames.has(name)) name = "Player " + (i + 1);
      usedNames.add(name);
      return { name };
    });
    for (const p of batch) {
      if (!p.isBot) send(p, "match-found", { mode, total: batch.length, roster });
    }
    startVote(r);
  }
}

function startVote(r) {
  if (!rooms.has(r.id)) return;
  clearTimeout(r.timer);
  r.phase = "vote";
  r.round += 1;
  r.votes.clear();
  r.question = shufflePick(QUESTIONS);
  cast(r, "round", {
    round: r.round,
    alive: r.alive.size,
    total: r.players.size,
    seconds: SECONDS,
    question: r.question
  });
  r.timer = setTimeout(() => resolveVote(r), SECONDS * 1000);
}
function resolveVote(r) {
  if (!rooms.has(r.id) || r.phase !== "vote") return;
  const yes = [...r.votes.values()].filter(v => v === "YES").length;
  const no = [...r.votes.values()].filter(v => v === "NO").length;
  const nonVoters = [...r.alive].filter(id => !r.votes.has(id));
  for (const id of nonVoters) r.alive.delete(id);

  if (yes === no) {
    cast(r, "round-result", {
      tied: true, yes, no, alive: r.alive.size,
      message: "It's a tie. No side is eliminated. The round will repeat."
    });
    if (r.alive.size < 2) {
      const survivor = [...r.alive][0];
      if (survivor) finish(r, survivor, "last-player-standing");
      else closeRoom(r);
    } else {
      r.timer = setTimeout(() => r.alive.size <= 2 ? startFinal(r) : startVote(r), 2400);
    }
    return;
  }

  const majority = yes > no ? "YES" : "NO";
  const eliminated = [];
  for (const [id, vote] of r.votes) {
    if (vote !== majority) {
      r.alive.delete(id);
      eliminated.push(id);
    }
  }
  cast(r, "round-result", {
    tied: false, yes, no, majority, eliminated: eliminated.length,
    alive: r.alive.size,
    message: majority + " received the majority. " + eliminated.length + " player(s) eliminated."
  });
  for (const id of eliminated) safeSend(r.players.get(id), "eliminated", {
    message: "You were on the smaller side. This match is over for you."
  });
  if (r.alive.size < 2) {
    const winner = [...r.alive][0];
    if (winner) finish(r, winner, "last-player-standing");
    else closeRoom(r);
  } else {
    r.timer = setTimeout(() => r.alive.size <= 2 ? startFinal(r) : startVote(r), 2600);
  }
}

function createFinalQuestions(r) {
  const ids = [...r.alive].slice(0, 2);
  const qa = shufflePick(QUIZ);
  let qb = shufflePick(QUIZ);
  while (qb.q === qa.q) qb = shufflePick(QUIZ);
  r.final = { ids, qs: new Map([[ids[0], qa], [ids[1], qb]]), answers: new Map(), choices: new Map() };
}
function startFinal(r) {
  if (!rooms.has(r.id)) return;
  clearTimeout(r.timer);
  const ids = [...r.alive];
  if (ids.length < 2) {
    if (ids[0]) finish(r, ids[0], "last-player-standing");
    else closeRoom(r);
    return;
  }
  r.phase = "final";
  createFinalQuestions(r);
  for (const id of r.final.ids) {
    const quiz = r.final.qs.get(id);
    send(r.players.get(id), "final-question", { question: quiz.q, options: quiz.a });
  }
  r.timer = setTimeout(() => resolveFinal(r), 20000);
}
function resolveFinal(r) {
  if (r.phase !== "final" || !r.final) return;
  const [a, b] = r.final.ids;
  const ra = r.final.answers.get(a) === r.final.qs.get(a).c;
  const rb = r.final.answers.get(b) === r.final.qs.get(b).c;
  if (ra !== rb) return finish(r, ra ? a : b, "final-questions");
  r.phase = "final-choice";
  r.final.choices.clear();
  cast(r, "final-choice", { message: "Same result! Choose REPEAT or RANDOM." });
  r.timer = setTimeout(() => startQuick(r), 15000);
}
function repeatFinal(r) {
  const [a, b] = r.final.ids;
  const qa = shufflePick(QUIZ);
  let qb = shufflePick(QUIZ);
  while (qb.q === qa.q) qb = shufflePick(QUIZ);
  r.phase = "final";
  r.final.qs = new Map([[a, qa], [b, qb]]);
  r.final.answers.clear();
  r.final.choices.clear();
  for (const id of [a, b]) {
    const quiz = r.final.qs.get(id);
    send(r.players.get(id), "final-question", { question: quiz.q, options: quiz.a });
  }
  r.timer = setTimeout(() => resolveFinal(r), 20000);
}
function startQuick(r) {
  if (!rooms.has(r.id) || !r.final) return;
  clearTimeout(r.timer);
  r.phase = "quick";
  r.quick = {
    scores: new Map(r.final.ids.map(id => [id, 0])),
    q: null,
    answers: new Map(),
    first: null
  };
  nextQuick(r);
}
function nextQuick(r) {
  if (r.phase !== "quick") return;
  r.quick.q = shufflePick(QUIZ);
  r.quick.answers.clear();
  r.quick.first = null;
  cast(r, "quick-question", {
    question: r.quick.q.q,
    options: r.quick.q.a,
    scores: Object.fromEntries(r.quick.scores),
    target: TARGET_SCORE
  });
  r.timer = setTimeout(() => {
    if (r.phase !== "quick") return;
    const [a, b] = r.final.ids;
    const sa = r.quick.scores.get(a), sb = r.quick.scores.get(b);
    if (sa >= TARGET_SCORE || sb >= TARGET_SCORE) {
      finish(r, sa === sb ? r.quick.first : (sa > sb ? a : b), "quick-question");
      return;
    }
    cast(r, "quick-result", { scores: Object.fromEntries(r.quick.scores), message: "Time is up. Next question." });
    r.timer = setTimeout(() => nextQuick(r), 1200);
  }, 12000);
}
function finish(r, winner, reason) {
  if (!rooms.has(r.id) || r.phase === "finished") return;
  clearTimeout(r.timer);
  r.phase = "finished";
  for (const [id, p] of r.players) {
    if (id === winner) {
      p.strike = (p.strike || 0) + 1;
      send(p, "match-result", { winner: true, strike: p.strike, reason });
    } else {
      p.strike = 0;
      send(p, "match-result", { winner: false, strike: 0, reason });
    }
  }
  r.timer = setTimeout(() => closeRoom(r), 8000);
}
function closeRoom(r) {
  clearTimeout(r.timer);
  rooms.delete(r.id);
  for (const p of r.players.values()) {
    p.room = null;
    send(p, "match-closed", {});
  }
}

function message(p, m) {
  if (!m || typeof m !== "object") return;
  if (m.type === "join") {
    if (!p.room) qadd(p, m.mode);
    return;
  }
  const r = p.room && rooms.get(p.room);
  if (!r) return send(p, "error", { message: "Join matchmaking first." });

  if (m.type === "vote" && r.phase === "vote" && r.alive.has(p.id) && !r.votes.has(p.id)) {
    const vote = String(m.vote || "").toUpperCase();
    if (!["YES", "NO"].includes(vote)) return;
    r.votes.set(p.id, vote);
    send(p, "vote-locked", { vote });
    if (r.votes.size === r.alive.size) {
      clearTimeout(r.timer);
      resolveVote(r);
    }
    return;
  }
  if (m.type === "final-answer" && r.phase === "final" && r.final.ids.includes(p.id) && !r.final.answers.has(p.id)) {
    const answer = Number(m.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return;
    r.final.answers.set(p.id, answer);
    send(p, "answer-locked", {});
    if (r.final.answers.size === 2) {
      clearTimeout(r.timer);
      resolveFinal(r);
    }
    return;
  }
  if (m.type === "final-choice" && r.phase === "final-choice" && r.final.ids.includes(p.id) && !r.final.choices.has(p.id)) {
    const choice = String(m.choice || "").toUpperCase();
    if (!["REPEAT", "RANDOM"].includes(choice)) return;
    r.final.choices.set(p.id, choice);
    send(p, "choice-locked", {});
    if (r.final.choices.size === 2) {
      clearTimeout(r.timer);
      const [a, b] = r.final.ids;
      const ca = r.final.choices.get(a), cb = r.final.choices.get(b);
      if (ca !== cb) startQuick(r);
      else if (ca === "RANDOM") finish(r, randomInt(2) ? a : b, "random");
      else repeatFinal(r);
    }
    return;
  }
  if (m.type === "quick-answer" && r.phase === "quick" && r.final.ids.includes(p.id) && !r.quick.answers.has(p.id)) {
    const answer = Number(m.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return;
    const correct = answer === r.quick.q.c;
    r.quick.answers.set(p.id, answer);
    if (correct && !r.quick.first) {
      r.quick.first = p.id;
      r.quick.scores.set(p.id, r.quick.scores.get(p.id) + 1);
    }
    send(p, "quick-answer-result", { correct, point: correct && r.quick.first === p.id });
    const [a, b] = r.final.ids;
    const sa = r.quick.scores.get(a), sb = r.quick.scores.get(b);
    if (sa >= TARGET_SCORE || sb >= TARGET_SCORE) {
      return finish(r, sa === sb ? r.quick.first : (sa > sb ? a : b), "quick-question");
    }
    if (r.quick.answers.size === 2) {
      clearTimeout(r.timer);
      cast(r, "quick-result", { scores: Object.fromEntries(r.quick.scores), message: "Round complete." });
      r.timer = setTimeout(() => nextQuick(r), 1200);
    }
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, service: "the-majority", rooms: rooms.size,
      queued: queues.duel.length + queues.crowd.length
    }));
  }
  if (path === "/" || path === "/online.html") {
    try {
      const html = fs.readFileSync(__dirname + "/online.html");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    } catch (error) {
      res.writeHead(500);
      return res.end("Game page unavailable.");
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found.");
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });
wss.on("connection", ws => {
  const p = { id: randomId(), ws, room: null, strike: 0, isBot: false };
  send(p, "connected", { playerId: p.id, duelPlayers: 2, crowdPlayers: CROWD_SIZE });
  ws.on("message", raw => {
    try { message(p, JSON.parse(raw.toString())); }
    catch (error) { send(p, "error", { message: "Invalid message." }); }
  });
  ws.on("close", () => {
    for (const q of Object.values(queues)) {
      const index = q.indexOf(p);
      if (index >= 0) q.splice(index, 1);
    }
    const r = p.room && rooms.get(p.room);
    if (!r || r.phase === "finished") return;
    r.alive.delete(p.id);
    r.votes.delete(p.id);
    if (r.final && r.final.ids.includes(p.id)) {
      const other = r.final.ids.find(id => id !== p.id && r.alive.has(id));
      if (other) finish(r, other, "opponent-disconnected");
      else closeRoom(r);
      return;
    }
    if (r.alive.size === 1) {
      finish(r, [...r.alive][0], "last-player-standing");
    } else if (r.alive.size === 0) {
      closeRoom(r);
    } else if (r.phase === "vote" && r.votes.size >= r.alive.size) {
      clearTimeout(r.timer);
      resolveVote(r);
    }
  });
});

server.listen(PORT, () => console.log("THE MAJORITY server listening on " + PORT + "; crowd size " + CROWD_SIZE));
