// relayer/seed-data.ts
//
// Starter fixtures inserted into Mongo on first connect. These mirror the
// dashboard's design data (app/src/app/components/*) so the UI looks identical
// whether it's reading from fixtures or from a freshly-seeded database.

import type { GroupDoc, MessageDoc, BetDoc, PlayerDoc } from "./db";

export const SEED_GROUPS: GroupDoc[] = [
  { id: "1", name: "The Dev Pack", initials: "DP", members: 8,  pendingBet: true,  lastMsg: "Kevin just dropped a bet 🔥", time: "2:18 PM" },
  { id: "2", name: "Grind Season", initials: "GS", members: 5,  pendingBet: false, lastMsg: "Who's running tomorrow AM?",    time: "1:04 PM" },
  { id: "3", name: "Ship It Gang",  initials: "SI", members: 12, pendingBet: true,  lastMsg: "New DevBet awaiting votes",     time: "11:42 AM" },
  { id: "4", name: "Alpha Cadre",   initials: "AC", members: 3,  pendingBet: false, lastMsg: "Nice streak, Matt! 🏆",         time: "Yesterday" },
];

export const SEED_BETS: BetDoc[] = [
  {
    id: "bet-001", type: "PERSONAL",
    challenger: "Kevin", acceptor: "Matt",
    terms: "Kevin wagers Matt that Matt cannot run a 5k tomorrow morning",
    stake: "500", currency: "POINTS",
    status: "PENDING", witnesses: 1, minBettors: 2, groupSize: 8,
  },
  {
    id: "bet-002", type: "DEV",
    challenger: "Sarah", acceptor: "Jordan",
    terms: "Sarah bets Jordan cannot ship a full-stack feature before midnight",
    stake: "0.25", currency: "SOL",
    status: "ACTIVE", witnesses: 2, minBettors: 2, groupSize: 8,
  },
];

export const SEED_MESSAGES: MessageDoc[] = [
  { id: "m1", groupId: "1", sender: "Kevin",  initials: "KV", text: "Alright, I'm feeling extremely bold today. Someone get in the ring with me.", system: false, ts: "2:10 PM",  createdAt: 1 },
  { id: "m2", groupId: "1", sender: "Matt",   initials: "MT", text: "Oh yeah? What's the move 👀",                                                  system: false, ts: "2:11 PM",  createdAt: 2 },
  { id: "m3", groupId: "1", sender: "System", initials: "SY", betId: "bet-001",                                                                    system: true,  ts: "2:14 PM",  createdAt: 3 },
  { id: "m4", groupId: "1", sender: "Jordan", initials: "JD", text: "LMAOOO Kevin is not playing around 💀",                                       system: false, ts: "2:15 PM",  createdAt: 4 },
  { id: "m5", groupId: "1", sender: "Sarah",  initials: "SR", text: "Matt you better have your running shoes ready 👟",                            system: false, ts: "2:16 PM",  createdAt: 5 },
  { id: "m6", groupId: "1", sender: "System", initials: "SY", betId: "bet-002",                                                                    system: true,  ts: "11:02 AM", createdAt: 6 },
  { id: "m7", groupId: "1", sender: "Kevin",  initials: "KV", text: "Dev bets hit different fr. AI doesn't lie 🤖",                                system: false, ts: "2:18 PM",  createdAt: 7 },
  { id: "m8", groupId: "1", sender: "Matt",   initials: "MT", text: "Fine. Fine. I accept. But if I lose I'm deleting the app 😤",                 system: false, ts: "2:19 PM",  createdAt: 8 },
];

export const SEED_PLAYERS: PlayerDoc[] = [
  { rank: 1, name: "Sarah Chen",  initials: "SC", github: "sarahcodes", pals: 12450, palsDelta: 1200, sol: 2.41, solDelta: 0.80,  wins: 18, disputes: 21, streak: 7, streakDir: "up" },
  { rank: 2, name: "Kevin Park",  initials: "KP", github: "kev_dev",    pals: 9820,  palsDelta: 540,  sol: 1.75, solDelta: 0.30,  wins: 14, disputes: 18, streak: 3, streakDir: "up" },
  { rank: 3, name: "Jordan Lee",  initials: "JL", github: "jleebuilds", pals: 8110,  palsDelta: -320, sol: 1.22, solDelta: -0.15, wins: 11, disputes: 17, streak: 0, streakDir: "neutral" },
  { rank: 4, name: "Matt Rivera", initials: "MR", github: "matt_riv",   pals: 7340,  palsDelta: 860,  sol: 0.98, solDelta: 0.40,  wins: 9,  disputes: 13, streak: 2, streakDir: "up" },
  { rank: 5, name: "Alex Kim",    initials: "AK", github: "alexbuilds", pals: 5900,  palsDelta: -150, sol: 0.64, solDelta: -0.05, wins: 7,  disputes: 12, streak: 0, streakDir: "neutral" },
  { rank: 6, name: "Dana Wu",     initials: "DW", github: "danawu_dev", pals: 4200,  palsDelta: 210,  sol: 0.38, solDelta: 0.10,  wins: 5,  disputes: 10, streak: 1, streakDir: "up" },
  { rank: 7, name: "Chris Obi",   initials: "CO", github: "chrisobi",   pals: 2750,  palsDelta: -80,  sol: 0.21, solDelta: -0.02, wins: 3,  disputes: 9,  streak: 0, streakDir: "down" },
];
