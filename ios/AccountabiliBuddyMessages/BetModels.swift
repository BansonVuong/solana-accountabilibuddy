import Foundation

enum MessageBetType: String, Codable, CaseIterable, Identifiable {
    case PERSONAL
    case DEV

    var id: String { rawValue }

    var label: String {
        switch self {
        case .PERSONAL: return "PERSONAL"
        case .DEV: return "Sports"
        }
    }
}

enum MessageBetVoteChoice: String, Codable, CaseIterable, Identifiable {
    case challenger
    case acceptor

    var id: String { rawValue }
}

/// Leagues offered by the sports board, mirroring the web dashboard's SportsView.
enum MessageSportKind: String, Codable, CaseIterable, Identifiable {
    case nba
    case nfl
    case nhl
    case soccer

    var id: String { rawValue }

    var label: String {
        switch self {
        case .nba: return "NBA"
        case .nfl: return "NFL"
        case .nhl: return "NHL"
        case .soccer: return "Soccer"
        }
    }
}

/// One upcoming game returned by the relayer's `/scoreboard` feed.
struct MessageScoreboardGame: Codable, Identifiable, Equatable {
    let gameId: String
    let homeTeam: String
    let awayTeam: String
    let status: String
    let isFinal: Bool
    let startTime: String?
    let startTimeMs: Double?

    var id: String { gameId }

    /// Human-readable kickoff for the picker row; falls back to the raw status.
    var kickoffLabel: String {
        if let startTimeMs {
            let date = Date(timeIntervalSince1970: startTimeMs / 1000)
            return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
        }
        return status.isEmpty ? "Scheduled" : status
    }
}

struct MessageScoreboardResponse: Codable {
    let sport: String
    let league: String?
    let games: [MessageScoreboardGame]
}

struct MessageCreateBetRequest: Codable {
    let source: String
    let imessageConversationId: String
    let type: MessageBetType
    let acceptor: String
    let terms: String
    let stake: String
    let currency: String
    let sport: String?
    let gameId: String?
    let backsHome: Bool?
    let homeTeam: String?
    let awayTeam: String?
}

struct MessageConversation: Codable, Identifiable {
    let id: String
    let ownerUsername: String
    let members: [String]
    let joined: Bool
    let isOwner: Bool
    let createdAt: Double
}

struct MessageConversationResponse: Codable {
    let conversation: MessageConversation
}

struct MessageConversationCreateResponse: Codable {
    let conversation: MessageConversation
    let inviteUrl: String
}

struct MessageCreateBetResponse: Codable {
    let bet: MessageCreatedBet
}

struct MessageCreatedBet: Codable {
    let id: String
}

struct MessageDeepLinkResponse: Codable {
    let betId: String?
    let url: String?
}

struct MessageBetCardEnvelope: Codable {
    let card: MessageBetCard
}

struct MessageBetCard: Codable, Identifiable {
    struct GroupInfo: Codable {
        let id: String
        let name: String
    }

    struct StakeInfo: Codable {
        let amount: String
        let currency: String
    }

    struct VotesInfo: Codable {
        let challenger: Int
        let acceptor: Int
        let total: Int
        let byVoter: [String: MessageBetVoteChoice]
        let myVote: MessageBetVoteChoice?
    }

    struct SportsInfo: Codable {
        let sport: String?
        let gameId: String?
        let homeTeam: String?
        let awayTeam: String?
        let challengerBacksHome: Bool?
    }

    struct OnChainInfo: Codable {
        struct Signatures: Codable {
            let create: String?
            let accept: String?
            let settle: String?
        }

        struct ExplorerLinks: Codable {
            let create: String?
            let accept: String?
            let settle: String?
        }

        let enabled: Bool
        let state: String?
        let label: String
        let signatures: Signatures
        let explorer: ExplorerLinks
    }

    struct ActionsInfo: Codable {
        let canAccept: Bool
        let canVote: Bool
        let acceptEndpoint: String
        let voteEndpoint: String
    }

    struct LinksInfo: Codable {
        let deepLink: String
    }

    let betId: String
    let group: GroupInfo
    let type: MessageBetType
    let status: String
    let statusLabel: String
    let terms: String
    let stake: StakeInfo
    let challenger: String
    let acceptor: String
    let witnessesRequired: Int
    let votes: VotesInfo
    let winner: MessageBetVoteChoice?
    let winnerName: String?
    let validation: String
    let sports: SportsInfo?
    let onChain: OnChainInfo
    let actions: ActionsInfo
    let links: LinksInfo

    var id: String { betId }
}

struct MessageErrorResponse: Codable {
    let error: String
}

struct MessageAuthUser: Codable {
    let id: String
    let email: String
    let username: String
    let initials: String
    let createdAt: Double
}

struct MessageAuthResponse: Codable {
    let token: String
    let user: MessageAuthUser
}

struct MessageCurrentUserResponse: Codable {
    let user: MessageAuthUser
}

struct MessageProfile: Codable {
    let name: String
    let initials: String
    let github: String
    let wallet: String
    let solBalance: Double
}

struct MessageParticipantLinkResponse: Codable {
    let linked: Bool
    let username: String
}

struct MessageResolvedParticipant: Codable {
    let participantId: String
    let username: String
}

struct MessageParticipantsResponse: Codable {
    let participants: [MessageResolvedParticipant]
}
