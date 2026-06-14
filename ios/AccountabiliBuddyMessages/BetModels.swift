import Foundation

enum MessageBetType: String, Codable, CaseIterable, Identifiable {
    case PERSONAL
    case DEV

    var id: String { rawValue }
}

enum MessageBetVoteChoice: String, Codable, CaseIterable, Identifiable {
    case challenger
    case acceptor

    var id: String { rawValue }
}

struct MessageCreateBetRequest: Codable {
    let source: String
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
