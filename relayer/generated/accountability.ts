/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/accountability.json`.
 */
export type Accountability = {
  "address": "FV2FPehCpYdns2q4vGzF93cBfepiVXeww6ybQy7EmFju",
  "metadata": {
    "name": "accountability",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "acceptBet",
      "discriminator": [
        251,
        25,
        85,
        221,
        41,
        69,
        191,
        252
      ],
      "accounts": [
        {
          "name": "opponent",
          "writable": true,
          "signer": true
        },
        {
          "name": "sportsBet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sports_bet.creator",
                "account": "sportsBet"
              },
              {
                "kind": "account",
                "path": "sports_bet.game_id",
                "account": "sportsBet"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sportsBet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "backOut",
      "discriminator": [
        18,
        86,
        98,
        84,
        247,
        94,
        106,
        229
      ],
      "accounts": [
        {
          "name": "backer",
          "docs": [
            "Either participant may trigger the mutual back-out."
          ],
          "signer": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "sportsBet"
          ]
        },
        {
          "name": "opponent",
          "writable": true
        },
        {
          "name": "sportsBet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sports_bet.creator",
                "account": "sportsBet"
              },
              {
                "kind": "account",
                "path": "sports_bet.game_id",
                "account": "sportsBet"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sportsBet"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "cancelBet",
      "discriminator": [
        17,
        248,
        130,
        128,
        153,
        227,
        231,
        9
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "sportsBet"
          ]
        },
        {
          "name": "sportsBet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "account",
                "path": "sports_bet.game_id",
                "account": "sportsBet"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sportsBet"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createBet",
      "discriminator": [
        197,
        42,
        153,
        2,
        59,
        63,
        143,
        246
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "sportsBet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "gameId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sportsBet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "oraclePubkey",
          "type": "pubkey"
        },
        {
          "name": "sport",
          "type": "u8"
        },
        {
          "name": "gameId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "creatorBacksHome",
          "type": "bool"
        },
        {
          "name": "startTime",
          "type": "i64"
        },
        {
          "name": "settleAfter",
          "type": "i64"
        }
      ]
    },
    {
      "name": "escrowBet",
      "discriminator": [
        7,
        114,
        89,
        61,
        205,
        89,
        48,
        174
      ],
      "accounts": [
        {
          "name": "challenger",
          "writable": true,
          "signer": true
        },
        {
          "name": "opponent",
          "writable": true,
          "signer": true
        },
        {
          "name": "socialBet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  99,
                  105,
                  97,
                  108,
                  95,
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "challenger"
              },
              {
                "kind": "arg",
                "path": "betId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  99,
                  105,
                  97,
                  108,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "socialBet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "oraclePubkey",
          "type": "pubkey"
        },
        {
          "name": "betId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "endDate",
          "type": "i64"
        },
        {
          "name": "fallbackKind",
          "type": "u8"
        },
        {
          "name": "fallbackDest",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "resolve",
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "oracle",
          "signer": true
        },
        {
          "name": "staker",
          "writable": true,
          "relations": [
            "commitment"
          ]
        },
        {
          "name": "commitment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "staker"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "commitment"
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "didSucceed",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settleBet",
      "discriminator": [
        115,
        55,
        234,
        177,
        227,
        4,
        10,
        67
      ],
      "accounts": [
        {
          "name": "oracle",
          "signer": true
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "sportsBet"
          ]
        },
        {
          "name": "opponent",
          "writable": true
        },
        {
          "name": "sportsBet",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  98,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sports_bet.creator",
                "account": "sportsBet"
              },
              {
                "kind": "account",
                "path": "sports_bet.game_id",
                "account": "sportsBet"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  111,
                  114,
                  116,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "sportsBet"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "homeWon",
          "type": {
            "option": "bool"
          }
        }
      ]
    },
    {
      "name": "settleSocial",
      "discriminator": [
        236,
        120,
        132,
        142,
        22,
        182,
        106,
        129
      ],
      "accounts": [
        {
          "name": "oracle",
          "signer": true
        },
        {
          "name": "challenger",
          "writable": true,
          "relations": [
            "socialBet"
          ]
        },
        {
          "name": "opponent",
          "writable": true,
          "relations": [
            "socialBet"
          ]
        },
        {
          "name": "destination",
          "docs": [
            "(used only for the burn/charity fallback)."
          ],
          "writable": true
        },
        {
          "name": "socialBet",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  111,
                  99,
                  105,
                  97,
                  108,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "socialBet"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "u8"
        }
      ]
    },
    {
      "name": "stake",
      "discriminator": [
        206,
        176,
        202,
        18,
        200,
        209,
        179,
        108
      ],
      "accounts": [
        {
          "name": "staker",
          "writable": true,
          "signer": true
        },
        {
          "name": "commitment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "staker"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "commitment"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "oraclePubkey",
          "type": "pubkey"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "failureDestination",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "timeout",
      "discriminator": [
        9,
        54,
        46,
        169,
        156,
        189,
        80,
        247
      ],
      "accounts": [
        {
          "name": "cranker",
          "signer": true
        },
        {
          "name": "staker",
          "writable": true,
          "relations": [
            "commitment"
          ]
        },
        {
          "name": "commitment",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "staker"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "commitment"
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "commitment",
      "discriminator": [
        61,
        112,
        129,
        128,
        24,
        147,
        77,
        87
      ]
    },
    {
      "name": "socialBet",
      "discriminator": [
        57,
        150,
        53,
        20,
        236,
        154,
        156,
        90
      ]
    },
    {
      "name": "socialVault",
      "discriminator": [
        63,
        91,
        64,
        62,
        215,
        152,
        172,
        44
      ]
    },
    {
      "name": "sportsBet",
      "discriminator": [
        126,
        247,
        217,
        201,
        28,
        122,
        157,
        110
      ]
    },
    {
      "name": "sportsVault",
      "discriminator": [
        62,
        137,
        41,
        34,
        7,
        10,
        254,
        83
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroStake",
      "msg": "Stake amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "commitmentAlreadyResolved",
      "msg": "Commitment has already been resolved"
    },
    {
      "code": 6002,
      "name": "insufficientVaultBalance",
      "msg": "Vault does not contain the recorded stake"
    },
    {
      "code": 6003,
      "name": "invalidDestination",
      "msg": "Destination cannot be an escrow account"
    },
    {
      "code": 6004,
      "name": "unauthorizedOracle",
      "msg": "Only the commitment oracle can resolve"
    },
    {
      "code": 6005,
      "name": "invalidDeadline",
      "msg": "Deadline must be in the future"
    },
    {
      "code": 6006,
      "name": "deadlineNotReached",
      "msg": "Commitment deadline has not passed"
    },
    {
      "code": 6007,
      "name": "deadlinePassed",
      "msg": "Commitment deadline has passed"
    },
    {
      "code": 6008,
      "name": "zeroBet",
      "msg": "Bet stake must be greater than zero"
    },
    {
      "code": 6009,
      "name": "invalidStartTime",
      "msg": "Game must start in the future"
    },
    {
      "code": 6010,
      "name": "invalidSettleTime",
      "msg": "Settle time must be after kickoff"
    },
    {
      "code": 6011,
      "name": "invalidSport",
      "msg": "Unknown sport"
    },
    {
      "code": 6012,
      "name": "betNotOpen",
      "msg": "Bet is not open for an opponent"
    },
    {
      "code": 6013,
      "name": "betNotLocked",
      "msg": "Bet is not locked"
    },
    {
      "code": 6014,
      "name": "selfBet",
      "msg": "You cannot accept your own bet"
    },
    {
      "code": 6015,
      "name": "gameStarted",
      "msg": "The game has already started"
    },
    {
      "code": 6016,
      "name": "backOutWindowClosed",
      "msg": "Too late to back out — within 5 minutes of kickoff"
    },
    {
      "code": 6017,
      "name": "notAParticipant",
      "msg": "Only the creator or opponent may back out"
    },
    {
      "code": 6018,
      "name": "settleTooEarly",
      "msg": "It is too early to settle this bet"
    },
    {
      "code": 6019,
      "name": "invalidOpponent",
      "msg": "Opponent account does not match the bet"
    },
    {
      "code": 6020,
      "name": "invalidEndDate",
      "msg": "Resolve-by date must be in the future"
    },
    {
      "code": 6021,
      "name": "invalidFallbackKind",
      "msg": "Unknown fallback kind"
    },
    {
      "code": 6022,
      "name": "invalidOutcome",
      "msg": "Unknown settlement outcome"
    },
    {
      "code": 6023,
      "name": "fallbackTooEarly",
      "msg": "Fallback can only run after the resolve-by date"
    }
  ],
  "types": [
    {
      "name": "commitment",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "staker",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "commitmentState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "oraclePubkey",
            "type": "pubkey"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "failureDestination",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "commitmentState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "resolved"
          }
        ]
      }
    },
    {
      "name": "socialBet",
      "docs": [
        "A peer-judged 1v1 wager. Both sides stake equally at acceptance (escrowed into",
        "the vault); the winner takes the pot once the oracle settles from a witness-vote",
        "quorum. If the `end_date` (resolve-by) passes with no quorum, the oracle routes",
        "the pot to a precommitted fallback — refund both, burn, or send to a charity."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "challenger",
            "docs": [
              "Wallet that posted the bet and staked the \"challenger\" side."
            ],
            "type": "pubkey"
          },
          {
            "name": "opponent",
            "docs": [
              "Wallet that accepted and staked the \"acceptor\" side."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Per-side stake in lamports. The pot the winner collects is `2 * amount`."
            ],
            "type": "u64"
          },
          {
            "name": "oraclePubkey",
            "docs": [
              "Oracle (relayer) authorized to settle from the witness vote / fallback."
            ],
            "type": "pubkey"
          },
          {
            "name": "endDate",
            "docs": [
              "Resolve-by deadline (unix seconds). After it, the oracle may run the fallback."
            ],
            "type": "i64"
          },
          {
            "name": "fallbackKind",
            "docs": [
              "Precommitted fallback if unresolved by `end_date`: 0 = return, 1 = burn, 2 = charity."
            ],
            "type": "u8"
          },
          {
            "name": "fallbackDest",
            "docs": [
              "Destination for burn/charity fallbacks (ignored when fallback_kind == 0)."
            ],
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "socialBetState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "socialBetState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "locked"
          },
          {
            "name": "settled"
          }
        ]
      }
    },
    {
      "name": "socialVault",
      "type": {
        "kind": "struct",
        "fields": []
      }
    },
    {
      "name": "sportsBet",
      "docs": [
        "A 1v1 wager on the result of a real-world game. Either party stakes an equal",
        "amount; the winner takes the pot once the ESPN oracle crank settles it. The",
        "same account also backs \"group chat\" bets — those are just sports bets posted",
        "inside a group conversation. No witness is required: the result is publicly",
        "verifiable from the scoreboard."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "docs": [
              "Wallet that opened the bet and staked first."
            ],
            "type": "pubkey"
          },
          {
            "name": "opponent",
            "docs": [
              "Wallet that matched the stake; `None` while the bet is still open."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "amount",
            "docs": [
              "Per-side stake in lamports. The pot the winner collects is `2 * amount`."
            ],
            "type": "u64"
          },
          {
            "name": "oraclePubkey",
            "docs": [
              "Oracle (relayer) authorized to settle from the scraped result."
            ],
            "type": "pubkey"
          },
          {
            "name": "sport",
            "docs": [
              "Sport enum: 0 = soccer (incl. World Cup), 1 = nba, 2 = nfl."
            ],
            "type": "u8"
          },
          {
            "name": "gameId",
            "docs": [
              "ESPN game id, UTF-8, zero-padded to 32 bytes."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creatorBacksHome",
            "docs": [
              "True if the creator is backing the home team; the opponent gets the away",
              "side. (Draws refund both sides.)"
            ],
            "type": "bool"
          },
          {
            "name": "startTime",
            "docs": [
              "Kickoff time (unix seconds). Gates the back-out window."
            ],
            "type": "i64"
          },
          {
            "name": "settleAfter",
            "docs": [
              "Earliest time the oracle may settle (unix seconds) — typically game end."
            ],
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "sportsBetState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sportsBetState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "locked"
          },
          {
            "name": "settled"
          }
        ]
      }
    },
    {
      "name": "sportsVault",
      "type": {
        "kind": "struct",
        "fields": []
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": []
      }
    }
  ]
};
