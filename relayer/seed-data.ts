// relayer/seed-data.ts
//
// Starter fixtures inserted into Mongo on first connect. These mirror the
// dashboard's design data (app/src/app/components/*) so the UI looks identical
// whether it's reading from fixtures or from a freshly-seeded database.

import type { GroupDoc, MessageDoc, BetDoc, PlayerDoc, ProfileDoc } from "./db";

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
    stake: "0.05", currency: "SOL",
    status: "PENDING", witnesses: 1, minBettors: 2, groupSize: 8,
    votesByVoter: {},
  },
  {
    id: "bet-002", type: "DEV",
    challenger: "Sarah", acceptor: "Jordan",
    terms: "Sarah bets Jordan cannot ship a full-stack feature before midnight",
    stake: "0.25", currency: "SOL",
    status: "ACTIVE", witnesses: 2, minBettors: 2, groupSize: 8,
    votesByVoter: { Kevin: "challenger" },
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
  { rank: 1, name: "Sarah Chen",  initials: "SC", github: "sarahcodes", sol: 2.41, solDelta: 0.80,  wins: 18, disputes: 21, streak: 7, streakDir: "up" },
  { rank: 2, name: "Kevin Park",  initials: "KP", github: "kev_dev",    sol: 1.75, solDelta: 0.30,  wins: 14, disputes: 18, streak: 3, streakDir: "up" },
  { rank: 3, name: "Jordan Lee",  initials: "JL", github: "jleebuilds", sol: 1.22, solDelta: -0.15, wins: 11, disputes: 17, streak: 0, streakDir: "neutral" },
  { rank: 4, name: "Matt Rivera", initials: "MR", github: "matt_riv",   sol: 0.98, solDelta: 0.40,  wins: 9,  disputes: 13, streak: 2, streakDir: "up" },
  { rank: 5, name: "Alex Kim",    initials: "AK", github: "alexbuilds", sol: 0.64, solDelta: -0.05, wins: 7,  disputes: 12, streak: 0, streakDir: "neutral" },
  { rank: 6, name: "Dana Wu",     initials: "DW", github: "danawu_dev", sol: 0.38, solDelta: 0.10,  wins: 5,  disputes: 10, streak: 1, streakDir: "up" },
  { rank: 7, name: "Chris Obi",   initials: "CO", github: "chrisobi",   sol: 0.21, solDelta: -0.02, wins: 3,  disputes: 9,  streak: 0, streakDir: "down" },
];

export const SEED_PROFILES: ProfileDoc[] = [
  { id: "u-sc", name: "Sarah Chen", initials: "SC", github: "sarahcodes", bio: "Full-stack builder and accountability streak champion.", sol: 2.41, wins: 18, disputes: 21, streak: 7, streakDir: "up", createdAt: 1, updatedAt: 1 },
  { id: "u-kp", name: "Kevin Park", initials: "KP", github: "kev_dev", bio: "Ships quickly and pushes high-conviction bets.", sol: 1.75, wins: 14, disputes: 18, streak: 3, streakDir: "up", createdAt: 2, updatedAt: 2 },
  { id: "u-jl", name: "Jordan Lee", initials: "JL", github: "jleebuilds", bio: "Backend-focused engineer and weekend runner.", sol: 1.22, wins: 11, disputes: 17, streak: 0, streakDir: "neutral", createdAt: 3, updatedAt: 3 },
  { id: "u-mr", name: "Matt Rivera", initials: "MR", github: "matt_riv", bio: "Frontend dev with a love for challenge bets.", sol: 0.98, wins: 9, disputes: 13, streak: 2, streakDir: "up", createdAt: 4, updatedAt: 4 },
  { id: "u-ak", name: "Alex Kim", initials: "AK", github: "alexbuilds", bio: "Product-minded engineer improving consistency daily.", sol: 0.64, wins: 7, disputes: 12, streak: 0, streakDir: "neutral", createdAt: 5, updatedAt: 5 },
  { id: "u-dw", name: "Dana Wu", initials: "DW", github: "danawu_dev", bio: "Data and infra tinkerer with steady momentum.", sol: 0.38, wins: 5, disputes: 10, streak: 1, streakDir: "up", createdAt: 6, updatedAt: 6 },
  { id: "u-co", name: "Chris Obi", initials: "CO", github: "chrisobi", bio: "Early-stage builder focused on improving reliability.", sol: 0.21, wins: 3, disputes: 9, streak: 0, streakDir: "down", createdAt: 7, updatedAt: 7 },
];
