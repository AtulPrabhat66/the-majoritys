const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { promisify } = require("util");
const { Pool } = require("pg");
const scrypt = promisify(crypto.scrypt);
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : undefined, max: 5 });
let dbReady = false;
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


const QUESTION_GROUPS = ["students","families","small businesses","local communities","game developers","content creators","young people","city planners","sports teams","scientists","artists","teachers","travellers","remote workers","public libraries","neighbourhoods","new players","experienced gamers","future generations","community leaders","inventors","musicians","filmmakers","volunteers","team captains","public schools","universities","online communities","independent creators","urban residents","rural communities","environmental groups"];
const QUESTION_ACTIVITIES = ["learn a new skill every year","spend more time outdoors","work on creative projects","take part in community events","try unfamiliar hobbies","collaborate across different teams","explore local history","practice problem-solving","share knowledge with beginners","take regular breaks from screens","support local projects","learn basic financial skills","participate in team sports","visit museums and galleries","use public transport more often","read for pleasure","build things with their hands","volunteer for local causes","study a second language","spend time in nature","make things instead of buying them","learn about science","try different kinds of music","plan activities together","teach others what they know"];
const QUESTION_RESOURCES = ["public parks","creative spaces","community libraries","free learning resources","cycling paths","sports facilities","quiet study areas","local art events","reliable public transport","shared workspaces","science museums","accessible playgrounds","repair workshops","music programmes","technology clubs","community gardens","walking trails","youth centres","public sports courts","digital skills classes","local history projects","free cultural events","safe cycling routes","maker spaces","after-school clubs"];
const QUESTION_VALUES = ["creativity","teamwork","curiosity","patience","independence","kindness","practical skills","honesty","reliability","adventure","community spirit","environmental care","open-mindedness","fairness","self-discipline","clear communication","problem-solving","learning","friendship","responsibility"];
const QUESTION_GOALS = ["solve everyday problems","build stronger communities","learn difficult subjects","stay curious","make better decisions","share ideas","improve wellbeing","understand different viewpoints","create useful things","prepare for the future","work together","discover new interests","protect the environment","communicate clearly","make learning enjoyable"];
const QUESTION_TOPICS = ["digital safety","personal finance","climate science","media literacy","teamwork","creative writing","first aid","basic coding","healthy cooking","local history","space exploration","critical thinking","communication","environmental science","entrepreneurship","design","music theory","geography","time management","problem-solving"];
const QUESTION_CONTEXTS = ["during the school year","in local communities","at work","on weekends","while learning new skills","when planning for the future","in public spaces","during team projects","when making big decisions","as part of everyday life","in growing cities","when using technology","during free time","in community programmes","when solving problems"];
const QUESTION_TIMES = ["at school","after work","on weekends","during holidays","in the evening","throughout the year","in their free time","during group projects","before making decisions","while travelling"];
const QUESTION_VERBS = ["using","learning","visiting","building","sharing","organizing","supporting","creating","studying","practising","exploring","improving"];
const QUESTION_ALTERNATIVES = ["watching tutorials","reading instructions","learning from experience","working alone","asking an expert","joining a group","trying a new approach","using a digital tool","practising regularly","learning by teaching others"];
const FICTIONAL_PLACES = ["the floating city of Aerilon","the hidden kingdom of Veyra","a city beneath the ocean","the last human colony on Mars","a village inside a giant forest","the crystal moon of Nym","a kingdom where memories are currency","a future city run by friendly robots","an island that moves every night","a library between dimensions"];
const FICTIONAL_POWERS = ["time travel","speaking every language","controlling the weather","visiting parallel worlds","understanding animals","entering your own dreams","teleporting once a day","seeing possible futures","talking to fictional characters"];
const FICTIONAL_RULES = ["everyone must tell the truth for one day","people can swap skills for 24 hours","memories can be saved like files","everyone gets one extra hour each day","robots can vote in elections","dreams can be explored like virtual worlds","people can visit one alternate timeline","every home has a tiny friendly dragon","books can answer questions"];
function makeDebateCandidate(difficulty = "mid", category = "all") {
  if (category !== "all" && category !== "debate") return makeTopicDebate(difficulty, category);
  const pick = list => list[randomInt(list.length)];
  const templates = [
    () => "Should " + pick(QUESTION_GROUPS) + " have more opportunities to " + pick(QUESTION_ACTIVITIES) + "?",
    () => "Would everyday life improve if people had more " + pick(QUESTION_RESOURCES) + "?",
    () => "Should people prioritize " + pick(QUESTION_VALUES) + " over " + pick(QUESTION_VALUES) + "?",
    () => "Is " + pick(QUESTION_ACTIVITIES) + " a good way to " + pick(QUESTION_GOALS) + "?",
    () => "Should schools teach more about " + pick(QUESTION_TOPICS) + "?",
    () => "Would communities benefit from investing more in " + pick(QUESTION_RESOURCES) + "?",
    () => "Should everyone try to develop " + pick(QUESTION_VALUES) + "?",
    () => "Should " + pick(QUESTION_GROUPS) + " have more opportunities to " + pick(QUESTION_ACTIVITIES) + " " + pick(QUESTION_CONTEXTS) + "?",
    () => "Is " + pick(QUESTION_VERBS) + " " + pick(QUESTION_RESOURCES) + " " + pick(QUESTION_TIMES) + " useful for " + pick(QUESTION_GROUPS) + "?",
    () => "Would " + pick(QUESTION_GROUPS) + " benefit from " + pick(QUESTION_VERBS) + " " + pick(QUESTION_RESOURCES) + " " + pick(QUESTION_TIMES) + "?",
    () => "Should " + pick(QUESTION_GROUPS) + " be encouraged to " + pick(QUESTION_ACTIVITIES) + " " + pick(QUESTION_CONTEXTS) + "?",
    () => "Would " + pick(QUESTION_RESOURCES) + " make it easier for " + pick(QUESTION_GROUPS) + " to " + pick(QUESTION_GOALS) + "?",
    () => "Is " + pick(QUESTION_ACTIVITIES) + " a better way to " + pick(QUESTION_GOALS) + " than " + pick(QUESTION_ALTERNATIVES) + "?",
    () => "Would you explore " + pick(FICTIONAL_PLACES) + " if you could safely visit it?",
    () => "Should people be allowed to use " + pick(FICTIONAL_POWERS) + " in everyday life?",
    () => "Would society improve if " + pick(FICTIONAL_RULES) + "?",
    () => "Would you choose to live in " + pick(FICTIONAL_PLACES) + " for a year?",
    () => "Should a fantasy hero reveal a secret to save their kingdom?",
    () => "Would a world with friendly robots making routine decisions be better?",
    () => "Would you enter a mystery portal if you knew you could return safely?",
    () => "Should a game allow players to rewrite one rule after every level?",
    () => "Would a peaceful alien civilisation make a better neighbour than a human city?",
    () => "Is exploring an unknown planet more exciting than discovering an ancient underwater city?",
    () => "Should fictional kingdoms solve conflicts through competitions instead of battles?",
    () => "Would you trade all your digital devices for one year in a magical library?"
  ];
  return templates[randomInt(templates.length)]();
}
async function reserveUniqueQuestion(candidate, type) {
  const key = candidate.q.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const result = await db.query(
    "INSERT INTO used_questions(question_key,question_text,question_type) VALUES($1,$2,$3) ON CONFLICT(question_key) DO NOTHING RETURNING question_text",
    [key, candidate.q, type]
  );
  return result.rowCount ? candidate : null;
}
async function nextUniqueDebateQuestion(difficulty = "mid", category = "all") {
  for (let i = 0; i < 1000; i++) {
    const q = await reserveUniqueQuestion({ q: makeDebateCandidate(difficulty, category) }, "debate");
    if (q) return q.q;
  }
  throw new Error("Fresh debate questions temporarily unavailable; refusing to repeat a question.");
}
function makeArithmeticQuiz() {
  const a = randomInt(900000) + 10000, b = randomInt(900000) + 10000;
  const subtract = randomInt(2) === 1;
  const left = subtract ? Math.max(a,b) : a, right = subtract ? Math.min(a,b) : b;
  const answer = subtract ? left-right : left+right;
  const options = new Set([answer]);
  while(options.size<4){const offset=randomInt(200)+1;options.add(Math.max(0,answer+(randomInt(2)?offset:-offset)));}
  const shuffled=[...options].sort(()=>Math.random()-.5);
  return {q:"What is "+left.toLocaleString("en-US")+" "+(subtract?"−":"+")+" "+right.toLocaleString("en-US")+"?",a:shuffled.map(n=>n.toLocaleString("en-US")),c:shuffled.indexOf(answer)};
}
function makeLogicQuiz() {
  const first=randomInt(20)+3, step=randomInt(8)+2, answer=first+step*3;
  const options=[answer,answer+step,answer-step,answer+step*2].sort(()=>Math.random()-.5);
  return {q:"Complete the pattern: "+first+", "+(first+step)+", "+(first+step*2)+", ?",a:options.map(String),c:options.indexOf(answer)};
}
function makeRiddleQuiz() {
  const items=[
    {q:"What has keys but cannot open a lock?",a:["A piano","A map","A clock","A river"],c:0},
    {q:"What gets wetter the more it dries?",a:["A towel","A cloud","A sponge","A shadow"],c:0},
    {q:"What has a face and two hands but no arms or legs?",a:["A clock","A statue","A book","A mountain"],c:0},
    {q:"What can travel around the world while staying in one corner?",a:["A postage stamp","A compass","A suitcase","A photograph"],c:0}
  ];
  return {...shufflePick(items)};
}
function makeFictionQuiz() {
  const pick=list=>list[randomInt(list.length)];
  const artefacts=["a silver compass","a glowing seed","a map of forgotten stars","a crystal key","a clockwork bird","a book of changing doors"];
  const place=pick(FICTIONAL_PLACES), correct=pick(artefacts);
  const wrong=artefacts.filter(x=>x!==correct).sort(()=>Math.random()-.5).slice(0,3);
  const options=[correct,...wrong].sort(()=>Math.random()-.5);
  return {q:"In an imaginary story set in "+place+", which object is the special artefact?",a:options,c:options.indexOf(correct)};
}
function makeGeneratedQuiz() {
  return [makeArithmeticQuiz,makeLogicQuiz,makeRiddleQuiz,makeFictionQuiz][randomInt(4)]();
}
async function nextUniqueQuiz(difficulty = "mid", category = "all") {
  for (let i = 0; i < 250; i++) {
    const candidate = makeSubjectQuiz(difficulty, category);
    const reserved = await reserveUniqueQuestion(candidate, "quiz");
    if (reserved) return candidate;
  }
  for (let i = 0; i < QUIZ.length * 2; i++) {
    const candidate = shufflePick(QUIZ);
    const reserved = await reserveUniqueQuestion(candidate, "quiz");
    if (reserved) return candidate;
  }
  for (let i = 0; i < 500; i++) {
    const candidate = makeGeneratedQuiz();
    const reserved = await reserveUniqueQuestion(candidate, "quiz");
    if (reserved) return candidate;
  }
  throw new Error("Could not reserve a fresh quiz question; repeats are disabled.");
}


const QUESTION_CATEGORIES = {
  science: ["physics","chemistry","biology","astronomy","earth science","human body","experiments"],
  math: ["arithmetic","algebra","geometry","fractions","percentages","number patterns","probability"],
  history: ["ancient civilizations","world history","Indian history","inventions","exploration","historical events"],
  geography: ["countries","capitals","continents","oceans","mountains","rivers","maps and flags"],
  technology: ["computers","internet","programming","AI","cybersecurity","gadgets","space technology"],
  gaming: ["Minecraft","Mario","Pokémon","The Legend of Zelda","Sonic","gaming history","game mechanics","PC gaming"],
  sports: ["football","cricket","basketball","tennis","Olympics","athletics","sports rules"],
  movies: ["cinema","animation","film genres","movie history","television","storytelling"],
  anime: ["anime genres","manga","Japanese animation","anime storytelling","fictional worlds"],
  music: ["music theory","instruments","genres","composers","rhythm","music history"],
  literature: ["novels","poetry","authors","mythic stories","classic literature","language"],
  mythology: ["Greek mythology","Norse mythology","Egyptian mythology","Indian mythology","world folklore"],
  nature: ["animals","plants","ecosystems","oceans","weather","conservation"],
  food: ["cuisines","ingredients","cooking methods","nutrition basics","food history"],
  art: ["painting","sculpture","architecture","photography","design","cultural traditions"],
  logic: ["riddles","deduction","patterns","sequences","lateral thinking","brain teasers"],
  general: ["everyday knowledge","world facts","language","inventions","culture","people and places"]
};
const SUBJECT_QUIZ = {
 easy: [
  ["science","Which planet is called the Red Planet?",["Venus","Mars","Jupiter","Mercury"],1],
  ["science","What do plants absorb from the air?",["Oxygen","Carbon dioxide","Helium","Hydrogen"],1],
  ["geography","Which is the largest ocean?",["Atlantic","Indian","Pacific","Arctic"],2],
  ["geography","How many continents are commonly taught in the world model?",["5","6","7","8"],2],
  ["nature","Which is the largest living mammal?",["Elephant","Blue whale","Giraffe","Orca"],1],
  ["technology","What does CPU commonly stand for?",["Central Processing Unit","Computer Power Utility","Core Program Unit","Central Print Unit"],0],
  ["gaming","Which company created Mario?",["SEGA","Nintendo","Atari","Sony"],1],
  ["gaming","In Minecraft, which block is commonly used to build a Nether portal?",["Stone","Obsidian","Dirt","Copper"],1],
  ["sports","How many players from one cricket team are on the field in normal play?",["9","10","11","12"],2],
  ["math","How many sides does a hexagon have?",["5","6","7","8"],1],
  ["food","Which ingredient is used to make traditional bread rise?",["Yeast","Salt only","Pepper","Vinegar"],0],
  ["music","Which instrument typically has black and white keys?",["Flute","Piano","Drum","Violin"],1],
  ["anime","What is the Japanese term commonly used for animated works?",["Anime","Kabuki","Haiku","Origami"],0],
  ["history","Which ancient civilization built the pyramids at Giza?",["Romans","Ancient Egyptians","Aztecs","Vikings"],1],
  ["logic","What has keys but cannot open a door?",["A piano","A map","A clock","A river"],0]
 ],
 mid: [
  ["science","What is the chemical symbol for sodium?",["So","Sd","Na","S"],2],
  ["science","Which cell structure is best known for producing most cellular ATP?",["Nucleus","Mitochondrion","Ribosome","Cell wall"],1],
  ["geography","Which strait separates India and Sri Lanka?",["Palk Strait","Bering Strait","Gibraltar","Malacca Strait"],0],
  ["history","The Renaissance began in which present-day country?",["France","Italy","Germany","Spain"],1],
  ["technology","What does HTTP stand for?",["HyperText Transfer Protocol","High Transfer Text Process","Host Terminal Transfer Program","Hyperlink Text Tracking Protocol"],0],
  ["gaming","Which studio developed the original The Witcher game?",["CD Projekt Red","Bethesda","Valve","BioWare"],0],
  ["gaming","In Pokémon games, which type is super effective against Water?",["Fire","Grass","Ground","Rock"],1],
  ["sports","How many points is a successful free throw worth in basketball?",["1","2","3","4"],0],
  ["math","What is the value of 15% of 200?",["20","25","30","35"],2],
  ["anime","Which art form is the printed counterpart most closely associated with anime?",["Manga","Haiku","Ikebana","Noh"],0],
  ["music","How many semitones are in an octave in standard Western equal temperament?",["8","10","12","14"],2],
  ["nature","What is the process by which plants lose water vapour through leaves?",["Respiration","Transpiration","Fermentation","Pollination"],1],
  ["literature","Who wrote the play Hamlet?",["Charles Dickens","William Shakespeare","Jane Austen","George Orwell"],1],
  ["mythology","In Greek mythology, who is the god of the sea?",["Apollo","Ares","Poseidon","Hermes"],2],
  ["logic","If all Bloops are Razzies and all Razzies are Lazzies, what must be true?",["All Lazzies are Bloops","All Bloops are Lazzies","No Bloops are Lazzies","Some Bloops are not Razzies"],1]
 ],
 hard: [
  ["science","Which particle carries the electromagnetic force in the Standard Model?",["Gluon","Photon","W boson","Neutrino"],1],
  ["science","What is the approximate pH of a neutral solution at 25°C?",["0","5","7","14"],2],
  ["history","Which 1648 settlement is commonly associated with ending the Thirty Years' War?",["Treaty of Utrecht","Peace of Westphalia","Treaty of Versailles","Congress of Vienna"],1],
  ["geography","Which country contains the greatest number of time zones when overseas territories are included?",["Russia","United States","France","China"],2],
  ["technology","Which data structure follows the last-in, first-out principle?",["Queue","Stack","Tree","Graph"],1],
  ["gaming","Which game popularised the phrase and mechanic 'the cake is a lie'?",["Portal","Half-Life 2","BioShock","The Stanley Parable"],0],
  ["gaming","What is the name of the fictional continent where The Witcher stories mainly take place?",["Thedas","The Continent","Tamriel","Azeroth"],1],
  ["sports","In cricket, what is the term for taking three wickets in three consecutive deliveries?",["Maiden","Hat-trick","Yorker","Googly"],1],
  ["math","What is the derivative of x² with respect to x?",["x","2x","x²","2"],1],
  ["anime","Which Japanese animation director created the film Spirited Away?",["Makoto Shinkai","Hayao Miyazaki","Satoshi Kon","Mamoru Hosoda"],1],
  ["music","Which interval spans six semitones in equal temperament?",["Perfect fourth","Tritone","Perfect fifth","Major sixth"],1],
  ["nature","What is the term for animals most active at dawn and dusk?",["Nocturnal","Diurnal","Crepuscular","Arboreal"],2],
  ["literature","Who wrote One Hundred Years of Solitude?",["Jorge Luis Borges","Gabriel García Márquez","Pablo Neruda","Isabel Allende"],1],
  ["mythology","In Norse mythology, what is the name of the world tree?",["Yggdrasil","Bifröst","Valhalla","Midgard"],0],
  ["logic","A fair six-sided die is rolled twice. What is the probability of getting two sixes?",["1/6","1/12","1/18","1/36"],3]
 ],
 genius: [
  ["science","Which symmetry principle is most directly connected to conservation of electric charge?",["Gauge invariance","Galilean relativity","Parity violation","Baryogenesis"],0],
  ["science","In the Michaelis–Menten model, what does Km represent?",["Maximum velocity","Substrate concentration at half Vmax","Enzyme concentration","Activation energy"],1],
  ["math","What is the residue of 1/z at z = 0?",["0","1","2πi","Undefined"],1],
  ["math","What is the determinant of a 2×2 identity matrix?",["0","1","2","−1"],1],
  ["technology","What is the time complexity of binary search on a sorted array?",["O(1)","O(log n)","O(n)","O(n log n)"],1],
  ["technology","Which consensus mechanism requires validators to stake assets rather than perform proof-of-work mining?",["Proof of Stake","Proof of Work","Round robin","Flooding"],0],
  ["history","Which 19th-century conference formalised the European partition of much of Africa?",["Congress of Berlin","Congress of Vienna","Treaty of Tordesillas","Yalta Conference"],0],
  ["geography","Which oceanic feature is the deepest known point on Earth?",["Java Trench","Tonga Trench","Challenger Deep","Puerto Rico Trench"],2],
  ["gaming","Which algorithm is classically used for shortest paths with non-negative edge weights?",["A* only","Dijkstra's algorithm","Bubble sort","Kruskal's algorithm"],1],
  ["gaming","In game development, what does ECS commonly stand for?",["Entity Component System","Engine Control Script","Event Camera State","External Content Store"],0],
  ["sports","In chess, what is the minimum number of moves required for a possible checkmate by a player from the starting position?",["2","3","4","5"],0],
  ["literature","Which narrative technique begins a story in the middle of the action?",["Deus ex machina","In medias res","Anagnorisis","Peripeteia"],1],
  ["music","Which tuning system divides an octave into 12 equal logarithmic ratios?",["Just intonation","Equal temperament","Pythagorean comma","Meantone only"],1],
  ["nature","Which ecological concept describes the variety of life at genetic, species and ecosystem levels?",["Biomagnification","Biodiversity","Succession","Eutrophication"],1],
  ["logic","If a statement is equivalent to its contrapositive, which form is logically equivalent to 'If P then Q'?",["If Q then P","If not P then not Q","If not Q then not P","P and Q"],2]
 ]
};
function normalizeDifficulty(value){return ["easy","mid","hard","genius"].includes(String(value).toLowerCase())?String(value).toLowerCase():"mid";}
function normalizeCategory(value){const v=String(value||"all").toLowerCase();return v==="all"||Object.prototype.hasOwnProperty.call(QUESTION_CATEGORIES,v)||v==="debate"?v:"all";}
function makeSubjectQuiz(difficulty,category){
 const level=normalizeDifficulty(difficulty),cat=normalizeCategory(category);
 let pool=SUBJECT_QUIZ[level]||SUBJECT_QUIZ.mid;
 if(cat!=="all"&&cat!=="debate")pool=pool.filter(item=>item[0]===cat);
 if(pool.length){const item=shufflePick(pool);return {q:item[1],a:item[2],c:item[3]};}
 return makeGeneratedQuiz();
}
function makeTopicDebate(difficulty,category){
 const cat=normalizeCategory(category),level=normalizeDifficulty(difficulty);
 const topics=cat==="all"?Object.keys(QUESTION_CATEGORIES):cat==="debate"?["fictional","opinion"]: [cat];
 const topic=shufflePick(topics);
 const subjects=QUESTION_CATEGORIES[topic]||["imaginary worlds","everyday choices","future technology"];
 const subject=shufflePick(subjects);
 const levelPrompt={
  easy:["Would you like to learn more about ","Is it fun to explore ","Should everyone try "],
  mid:["Should schools and communities teach more about ","Would society benefit from investing in ","Is understanding ","],
  hard:["Should people critically evaluate new discoveries in ","Could advances in ","Is it ethical to use "],
  genius:["Should experts reconsider established assumptions about ","Could a breakthrough in ","Is it possible to build a consistent theory of "]
 }[level];
 const prompt=shufflePick(levelPrompt);
 const ending=prompt.endsWith(" ") ? "?" : " in the future?";
 if(topic==="fictional"||topic==="opinion")return shufflePick([
  "Would you explore a hidden world where memories can be traded?",
  "Should a game let players change one rule after every level?",
  "Would you choose to live in a city built beneath the ocean?",
  "Is teamwork more valuable than individual skill in a final challenge?"
 ]);
 return prompt+subject+ending;
}

const BOT_NAMES = [
  "Mira", "Vex", "Orion", "Nova", "Pixel", "Rook", "Echo", "Blitz",
  "Sage", "Atlas", "Kairo", "Iris", "Zed", "Clover", "Nyx", "Juno",
  "Axel", "Quinn", "Rune", "Skye", "Arlo", "Tess", "Onyx", "Sol"
];
const BOT_STYLES = ["analyst", "contrarian", "social", "risk-taker", "balanced", "instinct"];


async function initDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  await db.query(`CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(16) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions(expires_at)");
  await db.query(`CREATE TABLE IF NOT EXISTS used_questions (question_key TEXT PRIMARY KEY, question_text TEXT NOT NULL, question_type TEXT NOT NULL, used_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await db.query(`CREATE TABLE IF NOT EXISTS match_history (
    id BIGSERIAL PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    mode VARCHAR(12) NOT NULL,
    outcome VARCHAR(8) NOT NULL,
    reason VARCHAR(48) NOT NULL,
    rounds INTEGER NOT NULL DEFAULT 0,
    players_count INTEGER NOT NULL DEFAULT 2,
    streak_after INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS match_history_account_idx ON match_history(account_id, id DESC)");
  dbReady = true;
}
function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
async function issueSession(accountId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.query("INSERT INTO account_sessions(token_hash, account_id, expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')", [tokenHash(token), accountId]);
  return token;
}
async function accountForToken(token) {
  if (!dbReady || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await db.query("SELECT a.id,a.username,a.email FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>NOW()", [tokenHash(token)]);
  return result.rows[0] || null;
}
function jsonReply(res, status, data) {
  res.writeHead(status, { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff" });
  res.end(JSON.stringify(data));
}
async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) throw new Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}
async function authApi(req, res, path) {
  if (!dbReady) return jsonReply(res, 503, { error:"Account service is starting. Try again shortly." });
  try {
    if (path === "/api/signup" && req.method === "POST") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) return jsonReply(res,400,{error:"Username must be 3–16 letters, numbers, or underscores."});
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonReply(res,400,{error:"Enter a valid email address."});
      if (password.length < 10 || password.length > 128) return jsonReply(res,400,{error:"Password must be at least 10 characters."});
      const salt = crypto.randomBytes(16);
      const derived = await scrypt(password, salt, 64);
      const passwordHash = salt.toString("hex") + ":" + derived.toString("hex");
      let inserted;
      try {
        inserted = await db.query("INSERT INTO accounts(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,email", [username,email,passwordHash]);
      } catch (e) {
        if (e.code === "23505") return jsonReply(res,409,{error:"That username or email is already registered. Log in instead."});
        throw e;
      }
      const token = await issueSession(inserted.rows[0].id);
      return jsonReply(res,201,{token,account:inserted.rows[0]});
    }
    if (path === "/api/login" && req.method === "POST") {
      const body = await readJson(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const result = await db.query("SELECT id,username,email,password_hash FROM accounts WHERE email=$1", [email]);
      const account = result.rows[0];
      if (!account) return jsonReply(res,401,{error:"Email or password is incorrect."});
      const [saltHex, hashHex] = account.password_hash.split(":");
      const actual = await scrypt(password, Buffer.from(saltHex,"hex"), 64);
      const expected = Buffer.from(hashHex,"hex");
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual,expected)) return jsonReply(res,401,{error:"Email or password is incorrect."});
      const token = await issueSession(account.id);
      delete account.password_hash;
      return jsonReply(res,200,{token,account});
    }
    if (path === "/api/profile" && req.method === "GET") {
      const account = await accountForToken(String(req.headers.authorization || "").replace(/^Bearer\s+/i,""));
      if (!account) return jsonReply(res,401,{error:"Please log in again."});
      const [stats, history] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS matches,
          COUNT(*) FILTER (WHERE outcome='win')::int AS wins,
          COUNT(*) FILTER (WHERE outcome='loss')::int AS losses,
          COALESCE(MAX(streak_after),0)::int AS best_streak,
          COALESCE((SELECT streak_after FROM match_history WHERE account_id=$1 ORDER BY id DESC LIMIT 1),0)::int AS current_streak,
          COUNT(*) FILTER (WHERE outcome='win' AND mode='duel')::int AS duel_wins,
          COUNT(*) FILTER (WHERE outcome='win' AND mode='crowd')::int AS crowd_wins
          FROM match_history WHERE account_id=$1`,[account.id]),
        db.query("SELECT id,mode,outcome,reason,rounds,players_count,streak_after,created_at FROM match_history WHERE account_id=$1 ORDER BY id DESC LIMIT 30",[account.id])
      ]);
      return jsonReply(res,200,{account:{username:account.username},stats:stats.rows[0],history:history.rows});
    }
    if (path === "/api/me" && req.method === "GET") {
      const account = await accountForToken(String(req.headers.authorization || "").replace(/^Bearer\s+/i,""));
      return account ? jsonReply(res,200,{account}) : jsonReply(res,401,{error:"Please log in again."});
    }
    if (path === "/api/logout" && req.method === "POST") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i,"");
      if (/^[a-f0-9]{64}$/.test(token)) await db.query("DELETE FROM account_sessions WHERE token_hash=$1",[tokenHash(token)]);
      return jsonReply(res,200,{ok:true});
    }
    return jsonReply(res,404,{error:"Not found."});
  } catch (error) {
    console.error("Account API error:", error.message);
    return jsonReply(res,400,{error:"Could not process that request. Check your details and try again."});
  }
}

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
function botQuizAnswer(p, quiz) {
  const question = typeof quiz === "string" ? quiz : quiz.q;
  if (quiz && typeof quiz === "object" && Number.isInteger(quiz.c) && Math.random() < p.skill) return quiz.c;
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
      if (quiz && !r.final.answers.has(p.id)) message(p, { type: "final-answer", answer: botQuizAnswer(p, quiz) });
    } else if (type === "final-choice" && r.phase === "final-choice" && r.final && !r.final.choices.has(p.id)) {
      const choice = p.style === "risk-taker" ? "RANDOM" : p.style === "analyst" ? "REPEAT" : (Math.random() < p.skill ? "REPEAT" : "RANDOM");
      message(p, { type: "final-choice", choice });
    } else if (type === "quick-question" && r.phase === "quick" && r.quick && r.final.ids.includes(p.id) && !r.quick.answers.has(p.id)) {
      message(p, { type: "quick-answer", answer: botQuizAnswer(p, r.quick.q) });
    }
  }, delay);
}
function roomSize(mode) { return mode === "crowd" ? CROWD_SIZE : 2; }

async function qadd(p, mode = "duel", settings = {}) {
  mode = mode === "crowd" ? "crowd" : "duel";
  p.mode = mode;
  p.difficulty = normalizeDifficulty(settings.difficulty);
  p.category = normalizeCategory(settings.category);
  const q = queues[mode];
  const target = roomSize(mode);
  if (!q.includes(p)) q.push(p);
  // Put the player into the queue immediately; question generation must not delay matchmaking.
  send(p, "queue", {
    mode,
    position: q.filter(x => !x.isBot).indexOf(p) + 1,
    needed: Math.max(0, target - q.length),
    total: target,
    waitHint: mode === "duel" ? "DUEL MATCHES USUALLY START IN A FEW SECONDS" : "CROWD MATCHES MAY TAKE A LITTLE LONGER"
  });
  // Warm-up arrives as its own event so it can render while the queue is active.
  nextUniqueQuiz(p.difficulty, p.category).then(warmup => {
    if (q.includes(p) && !p.room) {
      send(p, "queue-warmup", { warmup: { question: warmup.q, options: warmup.a } });
    }
  }).catch(error => console.error("Queue warm-up question error:", error.message));
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
      difficulty: batch[0].difficulty || "mid",
      category: batch[0].category || "all",
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
    for (const viewer of batch) {
      if (viewer.isBot) continue;
      const usedNames = new Set();
      const roster = batch.map((p, i) => {
        let name = p.id === viewer.id ? "YOU" : (p.name || (p.isBot ? p.name : "Player " + String(i + 1).padStart(2, "0")));
        if (usedNames.has(name)) name = "Player " + String(i + 1).padStart(2, "0");
        usedNames.add(name);
        return { name, streak: Number(p.strike) || 0 };
      });
      send(viewer, "match-found", { mode, total: batch.length, roster });
    }
    startVote(r);
  }
}

async function startVote(r) {
  if (!rooms.has(r.id)) return;
  clearTimeout(r.timer);
  r.phase = "loading-question";
  r.round += 1;
  r.votes.clear();
  try { r.question = await nextUniqueDebateQuestion(r.difficulty, r.category); }
  catch (error) { console.error("Question generation error:", error.message); closeRoom(r); return; }
  if (!rooms.has(r.id) || r.phase !== "loading-question") return;
  r.phase = "vote";
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
    for (const id of nonVoters) eliminatePlayer(r.players.get(id),r,"You missed the vote and were removed from this match.","missed-vote");
    cast(r, "round-result", {
      tied: true, yes, no, alive: r.alive.size,
      message: "It's a tie. Voters survive. The round will repeat."
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

  for (const id of nonVoters) eliminatePlayer(r.players.get(id),r,"You missed the vote and were removed from this match.","missed-vote");
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
  for (const id of eliminated) eliminatePlayer(r.players.get(id),r,"You were on the smaller side. This match is over for you.","minority-vote");
  if (r.alive.size < 2) {
    const winner = [...r.alive][0];
    if (winner) finish(r, winner, "last-player-standing");
    else closeRoom(r);
  } else {
    r.timer = setTimeout(() => r.alive.size <= 2 ? startFinal(r) : startVote(r), 2600);
  }
}

async function createFinalQuestions(r) {
  const ids = [...r.alive].slice(0, 2);
  const qa = await nextUniqueQuiz(r.difficulty, r.category);
  const qb = await nextUniqueQuiz(r.difficulty, r.category);
  r.final = { ids, qs: new Map([[ids[0], qa], [ids[1], qb]]), answers: new Map(), choices: new Map() };
}
async function startFinal(r) {
  if (!rooms.has(r.id)) return;
  clearTimeout(r.timer);
  const ids = [...r.alive];
  if (ids.length < 2) {
    if (ids[0]) finish(r, ids[0], "last-player-standing");
    else closeRoom(r);
    return;
  }
  r.phase = "loading-final";
  try { await createFinalQuestions(r); }
  catch (error) { console.error("Final question error:", error.message); closeRoom(r); return; }
  if (!rooms.has(r.id) || r.phase !== "loading-final") return;
  r.phase = "final";
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
async function repeatFinal(r) {
  const [a, b] = r.final.ids;
  r.phase = "loading-final";
  let qa, qb;
  try { qa = await nextUniqueQuiz(r.difficulty, r.category); qb = await nextUniqueQuiz(r.difficulty, r.category); }
  catch (error) { console.error("Repeat final question error:", error.message); closeRoom(r); return; }
  if (!rooms.has(r.id) || r.phase !== "loading-final") return;
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
async function nextQuick(r) {
  if (r.phase !== "quick") return;
  let freshQuestion;
  try { freshQuestion = await nextUniqueQuiz(r.difficulty, r.category); }
  catch (error) { console.error("Sudden-death question error:", error.message); closeRoom(r); return; }
  if (!rooms.has(r.id) || r.phase !== "quick") return;
  r.quick.q = freshQuestion;
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
async function recordPlayerMatch(p, outcome, reason, r) {
  if (!p || p.isBot || !p.account?.id) return Number(p?.strike) || 0;
  const saved = await db.query(`WITH previous AS (
    SELECT streak_after FROM match_history WHERE account_id=$1 ORDER BY id DESC LIMIT 1
  )
  INSERT INTO match_history(account_id,mode,outcome,reason,rounds,players_count,streak_after)
  VALUES($1,$2,$3,$4,$5,$6,
    CASE WHEN $3='win' THEN COALESCE((SELECT streak_after FROM previous),0)+1 ELSE 0 END
  ) RETURNING streak_after`,
  [p.account.id,r.mode,outcome,String(reason||"match").slice(0,48),r.round,r.players.size]);
  p.strike = Number(saved.rows[0]?.streak_after) || 0;
  return p.strike;
}
function eliminatePlayer(p,r,message,reason) {
  if (!p) return;
  if (p.room === r.id) p.room = null;
  if (p.isBot) return;
  recordPlayerMatch(p,"loss",reason,r).catch(error=>console.error("Could not save match loss:",error.message))
    .finally(()=>safeSend(p,"eliminated",{message:message||"Your run has ended."}));
}
async function finish(r, winner, reason) {
  if (!rooms.has(r.id) || r.phase === "finished") return;
  clearTimeout(r.timer);
  r.phase = "finished";
  const activeIds=[...r.alive];
  await Promise.all(activeIds.map(async id=>{
    const p=r.players.get(id);if(!p)return;
    const won=id===winner;
    if(p.room===r.id)p.room=null;
    try { await recordPlayerMatch(p,won?"win":"loss",reason,r); }
    catch(error){console.error("Could not save match result:",error.message);p.strike=won?(Number(p.strike)||0)+1:0;}
    send(p,"match-result",{winner:won,strike:Number(p.strike)||0,reason});
  }));
  r.timer = setTimeout(() => closeRoom(r), 8000);
}
function closeRoom(r) {
  clearTimeout(r.timer);
  rooms.delete(r.id);
  for (const p of r.players.values()) {
    if (p.room === r.id) {
      p.room = null;
      send(p, "match-closed", {});
    }
  }
}

async function message(p, m) {
  if (!m || typeof m !== "object") return;
  if (m.type === "join") {
    if (!p.room) {
      const account = await accountForToken(m.token);
      if (!account) return send(p, "error", { message: "Please sign up or log in before playing." });
      p.account = account;
      p.name = account.username;
      const prior = await db.query("SELECT streak_after FROM match_history WHERE account_id=$1 ORDER BY id DESC LIMIT 1",[account.id]);
      p.strike = Number(prior.rows[0]?.streak_after || 0);
      await qadd(p, m.mode, {difficulty:m.difficulty,category:m.category});
    }
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
      else repeatFinal(r).catch(error => console.error("Final rematch question error:", error));
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
  if (path.startsWith("/api/")) return void authApi(req, res, path);
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({
      ok: true, service: "the-majority", rooms: rooms.size,
      queued: queues.duel.length + queues.crowd.length, accountsReady: dbReady
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
  const p = { id: randomId(), ws, room: null, strike: 0, isBot: false, name: "Player" };
  send(p, "connected", { playerId: p.id, duelPlayers: 2, crowdPlayers: CROWD_SIZE });
  ws.on("message", raw => {
    try { Promise.resolve(message(p, JSON.parse(raw.toString()))).catch(error => { console.error(error); send(p, "error", { message: "Could not process that action." }); }); }
    catch (error) { send(p, "error", { message: "Invalid message." }); }
  });
  ws.on("close", () => {
    for (const q of Object.values(queues)) {
      const index = q.indexOf(p);
      if (index >= 0) q.splice(index, 1);
    }
    const r = p.room && rooms.get(p.room);
    if (!r || r.phase === "finished") return;
    if (p.account?.id) recordPlayerMatch(p,"loss","disconnected",r).catch(error=>console.error("Could not save disconnect:",error.message));
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

initDatabase().catch(error => { dbReady = false; console.error("Account database unavailable:", error.message); }).finally(() => { server.listen(PORT, () => console.log("THE MAJORITY server listening on " + PORT + "; crowd size " + CROWD_SIZE + "; accounts " + (dbReady ? "ready" : "unavailable"))); });
